// DB regression tests for the money findings of docs/AUDIT-2026-10-17.md. Run: npm run test:integration
// Builds its own small center (no demo seed), so it does not depend on the order of test files.
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, fromISODate, todayISO, toISODate } from "@/lib/dates";
import { buildCtx, loadUser, type Ctx } from "@/lib/ctx-core";
import { generateLessons } from "@/lib/services/lessons";
import { importStudents, OPENING_PERIOD } from "@/app/(admin)/students/import/import-core";

const today = todayISO();
let ctx: Ctx;
let centerId = "";
let branchId = "";
let teacherId = "";
let groupCode = 0;

const phone = () => `9989${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

async function makeGroup(opts: { name: string; price?: number; pricingType?: "SUBSCRIPTION" | "PACKAGE"; packageLessons?: number | null; installments?: number; durationMonths?: number | null; startDate?: string; endDate?: string | null }) {
  const course = await db.course.create({
    data: { centerId, name: `${opts.name} course`, pricingType: opts.pricingType ?? "SUBSCRIPTION", price: opts.price ?? 600_000, lessonsPerWeek: 3, packageLessons: opts.packageLessons ?? null, installments: opts.installments ?? 1, durationMonths: opts.durationMonths ?? null },
  });
  const c = await db.center.update({ where: { id: centerId }, data: { groupSeq: { increment: 1 } }, select: { groupSeq: true } });
  const g = await db.group.create({
    data: {
      centerId,
      branchId,
      courseId: course.id,
      teacherId,
      code: c.groupSeq,
      name: opts.name,
      startDate: fromISODate(opts.startDate ?? addDays(today, -40)),
      endDate: opts.endDate ? fromISODate(opts.endDate) : null,
      slots: { create: [1, 3, 5].map((weekday) => ({ weekday, startTime: "09:00", endTime: "10:30" })) },
    },
  });
  await generateLessons(g.id, { today });
  return { group: g, course };
}

beforeAll(async () => {
  const center = await db.center.create({ data: { name: "Money audit", slug: `money-audit-${Date.now().toString(36)}`, plan: "PRO" } });
  centerId = center.id;
  branchId = (await db.branch.create({ data: { centerId, name: "Asosiy" } })).id;
  const owner = await db.user.create({ data: { centerId, phone: phone(), name: "Owner", passwordHash: "x", role: "OWNER" } });
  const teacher = await db.user.create({ data: { centerId, phone: phone(), name: "Teacher", passwordHash: "x", role: "TEACHER", isTeacher: true, branches: { create: { branchId } } } });
  teacherId = teacher.id;
  ctx = buildCtx((await loadUser(owner.id))!);
  groupCode = (await makeGroup({ name: "GE import" })).group.code;
});

describe("B5/B11 — student import is idempotent and dates the old debt", () => {
  const csv = () =>
    [
      "Familiya,Ism,Telefon,Ota-ona telefoni,Guruh,Balans,qarz_sanasi",
      `Karimov,Ali,901112233,935551122,${groupCode},"-300 000,00",15.08.2026`,
      `Karimova,Laylo,,935551122,${groupCode},0,`,
      `Saidov,Bobur,,,${groupCode},-150000,`,
      "Toshev,Anvar,,,,0,",
    ].join("\n");

  const counts = async () => ({
    students: await db.student.count({ where: { centerId } }),
    enrollments: await db.enrollment.count({ where: { group: { centerId } } }),
    openings: await db.ledgerEntry.count({ where: { centerId, period: OPENING_PERIOD } }),
    families: await db.family.count({ where: { centerId } }),
  });

  it("first import creates everything; the opening debt is dated from qarz_sanasi", async () => {
    const dry = await importStudents(ctx, csv(), true);
    expect(dry.errors).toEqual([]);
    expect(dry.created).toBe(4);
    expect(await counts()).toEqual({ students: 0, enrollments: 0, openings: 0, families: 0 });

    const res = await importStudents(ctx, csv(), false);
    expect(res.errors).toEqual([]);
    expect(res.created).toBe(4);
    expect(await counts()).toEqual({ students: 4, enrollments: 3, openings: 2, families: 3 });
    const ali = await db.student.findFirstOrThrow({ where: { centerId, firstName: "Ali" } });
    const opening = await db.ledgerEntry.findFirstOrThrow({ where: { studentId: ali.id, period: OPENING_PERIOD } });
    expect(opening).toMatchObject({ type: "CHARGE", amount: -300_000 });
    expect(toISODate(opening.date)).toBe("2026-08-15");
    const bobur = await db.student.findFirstOrThrow({ where: { centerId, firstName: "Bobur" } });
    const b = await db.ledgerEntry.findFirstOrThrow({ where: { studentId: bobur.id, period: OPENING_PERIOD } });
    expect(toISODate(b.date)).toBe(today);
  });

  it("importing the same file again creates no new row; the dry run says so", async () => {
    const before = await counts();
    const dry = await importStudents(ctx, csv(), true);
    expect(dry.created).toBe(0);
    expect(dry.existing).toBe(4);
    expect(dry.message).toContain(ctx.t("money.import.exists"));
    const res = await importStudents(ctx, csv(), false);
    expect(res.errors).toEqual([]);
    expect(res.created).toBe(0);
    expect(res.existing).toBe(4);
    expect(await counts()).toEqual(before);
    // names match without case; a new group for a known student only adds the enrollment
    const other = await makeGroup({ name: "GE import 2" });
    const again = await importStudents(ctx, `KARIMOV,ali,901112233,935551122,${other.group.code},-300000`, false);
    expect(again.errors).toEqual([]);
    expect(await counts()).toEqual({ ...before, enrollments: before.enrollments + 1 });
  });

  it("a future or broken debt date is refused", async () => {
    const res = await importStudents(ctx, [`Yangi,Odam,901234000,,${groupCode},-1000,${addDays(today, 3)}`, `Yangi,Ikki,901234001,,${groupCode},-1000,31.02.2026`].join("\n"), true);
    expect(res.errors).toHaveLength(2);
    expect(res.errors[0]).toContain(ctx.t("money.import.futureDebtSince"));
    expect(res.errors[1]).toContain(ctx.t("money.import.badDebtSince"));
  });
});
