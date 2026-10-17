// DB regression tests for the second money review (2026-10-17): import identity and limits (N1, N6),
// salary month validation (M1), salary expense branch (L6), reversal lock (L7), export lookup (L9).
// Run: npm run test:integration. Next's request APIs are mocked: the session cookie is signed for the owner.
import { beforeAll, describe, expect, it, vi } from "vitest";

process.env.AUTH_SECRET ??= "integration-test-secret-0123456789-abcdefgh";

const jar = new Map<string, string>();
vi.mock("server-only", () => ({}));
vi.mock("next/cache", () => ({ revalidatePath: () => {} }));
vi.mock("next/headers", () => ({
  cookies: async () => ({
    get: (k: string) => (jar.has(k) ? { name: k, value: jar.get(k)! } : undefined),
    set: (k: string, v: string) => void jar.set(k, v),
    delete: (k: string) => void jar.delete(k),
  }),
  headers: async () => new Headers(),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => {
    throw Object.assign(new Error(`NEXT_REDIRECT ${url}`), { digest: `NEXT_REDIRECT;replace;${url};307;` });
  },
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
  unstable_rethrow: (e: unknown) => {
    if (e instanceof Error && e.message.startsWith("NEXT_REDIRECT")) throw e;
  },
}));

const { NextRequest } = await import("next/server");
const { db } = await import("@/lib/db");
const { signSession, SESSION_COOKIE } = await import("@/lib/session");
const { buildCtx, loadUser } = await import("@/lib/ctx-core");
const { addDays, fromISODate, monthRange, todayISO } = await import("@/lib/dates");
const { generateLessons } = await import("@/lib/services/lessons");
const { importStudents, OPENING_PERIOD } = await import("@/app/(admin)/students/import/import-core");
const { addAdjustment, liveSalary, lockPayslip, markPayslipPaid } = await import("@/lib/salary/service");
const { adjustmentAction, payslipAction } = await import("@/app/(admin)/salary/actions");
const { refund, reverseEntry, takePayment } = await import("@/lib/services/payments");
const { familyBalance } = await import("@/lib/services/wallet");
const { GET } = await import("@/app/api/export/[kind]/route");
const { UserError } = await import("@/lib/user-error");

type Ctx = Awaited<ReturnType<typeof buildCtx>>;
const today = todayISO();
let ctx: Ctx;
let centerId = "";
let branchId = "";
let ownerId = "";
let teacherId = "";

const phone = () => `9989${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`;

async function makeGroup(name: string, opts: { branch?: string; teacher?: string } = {}) {
  const course = await db.course.create({ data: { centerId, name: `${name} course`, pricingType: "SUBSCRIPTION", price: 600_000, lessonsPerWeek: 3 } });
  const c = await db.center.update({ where: { id: centerId }, data: { groupSeq: { increment: 1 } }, select: { groupSeq: true } });
  const g = await db.group.create({
    data: {
      centerId,
      branchId: opts.branch ?? branchId,
      courseId: course.id,
      teacherId: opts.teacher ?? teacherId,
      code: c.groupSeq,
      name,
      startDate: fromISODate(addDays(today, -40)),
      slots: { create: [1, 3, 5].map((weekday) => ({ weekday, startTime: "09:00", endTime: "10:30" })) },
    },
  });
  await generateLessons(g.id, { today });
  return g;
}

beforeAll(async () => {
  const center = await db.center.create({ data: { name: "Money review 2", slug: `money-r2-${Date.now().toString(36)}`, plan: "PRO" } });
  centerId = center.id;
  branchId = (await db.branch.create({ data: { centerId, name: "Asosiy" } })).id;
  const owner = await db.user.create({ data: { centerId, phone: phone(), name: "Owner", passwordHash: "x", role: "OWNER" } });
  ownerId = owner.id;
  const teacher = await db.user.create({ data: { centerId, phone: phone(), name: "Teacher", passwordHash: "x", role: "TEACHER", isTeacher: true, branches: { create: { branchId } } } });
  teacherId = teacher.id;
  ctx = buildCtx((await loadUser(owner.id))!);
  jar.set(SESSION_COOKIE, await signSession({ sub: owner.id, cid: centerId }));
});

describe("N1 — a phoneless row never merges with a namesake by name alone", () => {
  it("re-import is a no-op; a namesake in another group (or without one) is a new student, flagged in the dry run", async () => {
    const g1 = await makeGroup("Phoneless 1");
    const g2 = await makeGroup("Phoneless 2");
    const csv = [`Valiyev,Ali,,,${g1.code},-100000`, "Valiyev,Bek,,,,0,"].join("\n");
    expect((await importStudents(ctx, csv, false)).created).toBe(2);
    const count = () => db.student.count({ where: { centerId, lastName: "Valiyev" } });
    expect(await count()).toBe(2);

    // the same rows again: nothing new
    const again = await importStudents(ctx, csv, false);
    expect(again).toMatchObject({ created: 0, existing: 2, errors: [] });
    expect(await count()).toBe(2);
    expect(await db.ledgerEntry.count({ where: { centerId, period: OPENING_PERIOD } })).toBe(1);

    // another "Ali Valiyev" without a phone in another group: a different child
    const other = `Valiyev,Ali,,,${g2.code},0`;
    const dry = await importStudents(ctx, other, true);
    expect(dry).toMatchObject({ created: 1, existing: 0, errors: [] });
    expect(dry.warnings).toHaveLength(1);
    expect(dry.message).toContain(ctx.t("money.import.possibleDuplicate", { name: "Valiyev Ali" }));
    const res = await importStudents(ctx, other, false);
    expect(res).toMatchObject({ created: 1, existing: 0, errors: [] });
    expect(await count()).toBe(3);
    const alis = await db.student.findMany({ where: { centerId, firstName: "Ali", lastName: "Valiyev" }, include: { enrollments: true } });
    expect(alis.map((s) => s.enrollments.map((e) => e.groupId)).sort()).toEqual([[g1.id], [g2.id]].sort());
    expect(new Set(alis.map((s) => s.familyId)).size).toBe(2);

    // without a group: the namesake with an enrollment is someone else; a different opening balance too
    expect((await importStudents(ctx, "Valiyev,Ali,,,,0", false)).created).toBe(1);
    expect((await importStudents(ctx, "Valiyev,Bek,,,,-50000", false)).created).toBe(1);
    expect(await count()).toBe(5);
  });
});

describe("N6 — import balances are capped like every money form", () => {
  it("an opening balance above 1 000 000 000 is refused in the dry run and the import", async () => {
    for (const dry of [true, false]) {
      const res = await importStudents(ctx, ["Katta,Qarz,,,,-1000000001", "Katta,Pul,,,,1 000 000 001", "Oddiy,Qarz,,,,-1000000000"].join("\n"), dry);
      expect(res.errors).toHaveLength(2);
      expect(res.errors[0]).toContain(ctx.t("money.import.balanceTooLarge", { max: "1 000 000 000 so'm" }));
      expect(res.created).toBe(1);
    }
    expect(await db.student.count({ where: { centerId, lastName: "Katta" } })).toBe(0);
  });
});

describe("M1 — salary month must be a real month", () => {
  it("actions refuse 2026-13 / 2026-00; the service refuses them too", async () => {
    for (const month of ["2026-13", "2026-00"]) {
      const r = await payslipAction(null, form({ teacherId, month, op: "lock" }));
      expect(r?.error).toBeTruthy();
      const a = await adjustmentAction(null, form({ teacherId, month, amount: "100000", reason: "bonus" }));
      expect(a?.error).toBeTruthy();
      const err = await liveSalary(centerId, teacherId, month).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(UserError);
      expect((await lockPayslip({ userId: ownerId, centerId }, teacherId, month).catch((e: unknown) => e)) instanceof UserError).toBe(true);
    }
    expect(await db.payslip.count({ where: { teacherId } })).toBe(0);
    expect(await db.salaryAdjustment.count({ where: { teacherId } })).toBe(0);
  });
});

function form(o: Record<string, string>) {
  const fd = new FormData();
  for (const [k, v] of Object.entries(o)) fd.append(k, v);
  return fd;
}

describe("L6 — salary expense branch of a multi-branch teacher", () => {
  it("is the branch where the teacher held most lessons that month", async () => {
    const second = (await db.branch.create({ data: { centerId, name: "Ikkinchi" } })).id;
    const t = await db.user.create({ data: { centerId, phone: phone(), name: "Two branches", passwordHash: "x", role: "TEACHER", isTeacher: true, branches: { create: [{ branchId }, { branchId: second }] } } });
    await db.salaryRule.create({ data: { teacherId: t.id, model: "PER_LESSON", perLesson: 50_000, validFrom: fromISODate("2026-01-01") } });
    const month = "2026-09";
    const { start } = monthRange(month);
    const ga = await makeGroup("Branch A group", { teacher: t.id });
    const gb = await makeGroup("Branch B group", { branch: second, teacher: t.id });
    const held = async (groupId: string, days: number[]) => {
      for (const d of days) await db.lesson.create({ data: { groupId, date: fromISODate(addDays(start, d)), startTime: "18:00", endTime: "19:00", teacherId: t.id, status: "HELD" } });
    };
    await held(ga.id, [0, 1]);
    await held(gb.id, [2, 3, 4]);
    const actor = { userId: ownerId, centerId };
    await lockPayslip(actor, t.id, month);
    await markPayslipPaid(actor, t.id, month);
    const slip = await db.payslip.findUniqueOrThrow({ where: { teacherId_month: { teacherId: t.id, month } } });
    expect(slip.total).toBe(250_000);
    expect((await db.expense.findUniqueOrThrow({ where: { id: slip.expenseId! } })).branchId).toBe(second);
    // a month without lessons: the teacher's oldest branch
    await addAdjustment(actor, t.id, "2026-08", 100_000, "bonus");
    await lockPayslip(actor, t.id, "2026-08");
    await markPayslipPaid(actor, t.id, "2026-08");
    const aug = await db.payslip.findUniqueOrThrow({ where: { teacherId_month: { teacherId: t.id, month: "2026-08" } } });
    expect((await db.expense.findUniqueOrThrow({ where: { id: aug.expenseId! } })).branchId).toBe(branchId);
  });
});

describe("L7 — a reversal and a refund of one family are serialized", () => {
  it("a refund waiting on a reversal sees the reversed balance and is refused without force", async () => {
    const fam = await db.family.create({ data: { centerId, name: "Race oilasi" } });
    const actor = { userId: ownerId, centerId };
    const pay = await takePayment(actor, { familyId: fam.id, amount: 500_000, method: "CASH" });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let reversed = false;
    const reversal = db.$transaction(
      async (tx) => {
        await reverseEntry(tx, actor, pay.id, "xato");
        reversed = true;
        await gate; // hold the transaction (and its lock) open
      },
      { timeout: 30_000 },
    );
    while (!reversed) await new Promise((r) => setTimeout(r, 10));
    const refunding = refund(actor, { familyId: fam.id, amount: 500_000, method: "CASH", reason: null }).catch((e: unknown) => e);
    await new Promise((r) => setTimeout(r, 300));
    release();
    await reversal;
    const err = await refunding;
    expect(err).toBeInstanceOf(UserError);
    expect((err as InstanceType<typeof UserError>).key).toBe("money.refundOverBalance");
    expect(await familyBalance(fam.id)).toBe(0);
  });
});

describe("L9 — export kinds are own keys only", () => {
  it("prototype keys are 404, a real kind is 200", async () => {
    for (const kind of ["constructor", "toString", "__proto__", "hasOwnProperty"]) {
      const res = await GET(new NextRequest(`http://localhost/api/export/${kind}`), { params: Promise.resolve({ kind }) });
      expect(res.status, kind).toBe(404);
    }
    const ok = await GET(new NextRequest("http://localhost/api/export/courses"), { params: Promise.resolve({ kind: "courses" }) });
    expect(ok.status).toBe(200);
  });
});
