// Report/list queries on hand-built fixtures (audit P1, P2, P4, P5, B12, B13, B14). Run: npm run test:integration
// Two private centers so the expected numbers don't depend on the demo seed or on other test files.
import { beforeAll, describe, expect, it } from "vitest";
import type { LedgerType, PaymentMethod } from "@prisma/client";
import { db } from "@/lib/db";
import { addDays, monthRange, shiftMonth, todayISO, fromISODate } from "@/lib/dates";
import { buildCtx, loadUser, type Ctx } from "@/lib/ctx-core";
import { listAllDebtors, listDebtors } from "@/lib/queries/debtors";
import { debtAging, leadFunnel, revenue, revenueByMonth, studentStats } from "@/lib/queries/reports";
import { studentIds } from "@/lib/queries/students";
import { studentSearch } from "@/lib/search";
import { listPayments } from "@/lib/queries/payments";
import { listAudit } from "@/lib/queries/audit";

const today = todayISO();
const day = (n: number) => fromISODate(addDays(today, n));

async function ctxOf(userId: string, activeBranchId: string | null = null): Promise<Ctx> {
  return buildCtx((await loadUser(userId))!, { activeBranchId });
}

async function staff(centerId: string, phone: string, role: "OWNER" | "ADMIN" | "TEACHER", branches: string[] = []) {
  return db.user.create({ data: { centerId, phone, name: `${role} ${phone.slice(-2)}`, role, perms: [], passwordHash: "-", branches: { create: branches.map((branchId) => ({ branchId })) } } });
}

// ------------------------------------------------------------------ center C: debtors, aging, search, audit
const C = { center: "", A: "", B: "", owner: "", adminA: "", ta: "", tb: "", gA: "", gB: "", fam: {} as Record<string, string>, st: {} as Record<string, string> };

async function entry(centerId: string, familyId: string, type: LedgerType, amount: number, date: Date, more: { key?: string; enrollmentId?: string; studentId?: string; method?: PaymentMethod; reversesId?: string } = {}) {
  return db.ledgerEntry.create({
    data: { centerId, familyId, type, amount, date, description: type, billingKey: more.key, enrollmentId: more.enrollmentId, studentId: more.studentId, method: more.method, reversesId: more.reversesId },
  });
}

async function buildC() {
  const center = await db.center.create({ data: { name: "RQ test", slug: "rq-test" } });
  C.center = center.id;
  C.A = (await db.branch.create({ data: { centerId: center.id, name: "A" } })).id;
  C.B = (await db.branch.create({ data: { centerId: center.id, name: "B" } })).id;
  C.owner = (await staff(center.id, "998955500001", "OWNER")).id;
  C.adminA = (await staff(center.id, "998955500002", "ADMIN", [C.A])).id;
  C.ta = (await staff(center.id, "998955500003", "TEACHER", [C.A])).id;
  C.tb = (await staff(center.id, "998955500004", "TEACHER", [C.B])).id;
  const course = await db.course.create({ data: { centerId: center.id, name: "English", pricingType: "SUBSCRIPTION", price: 300_000 } });
  C.gA = (await db.group.create({ data: { centerId: center.id, branchId: C.A, courseId: course.id, teacherId: C.ta, code: 1, name: "GA", startDate: day(-120) } })).id;
  C.gB = (await db.group.create({ data: { centerId: center.id, branchId: C.B, courseId: course.id, teacherId: C.tb, code: 2, name: "GB", startDate: day(-120) } })).id;
  const family = async (key: string, name: string, phone: string) => {
    C.fam[key] = (await db.family.create({ data: { centerId: center.id, name, guardians: { create: { name: `${name} ota`, phone, isPrimary: true } } } })).id;
  };
  const student = async (key: string, fam: string, firstName: string, lastName: string, branchId: string | null, groupId?: string, phone?: string) => {
    C.st[key] = (await db.student.create({ data: { centerId: center.id, familyId: C.fam[fam], firstName, lastName, branchId, phone } })).id;
    if (groupId) return (await db.enrollment.create({ data: { studentId: C.st[key], groupId, startDate: day(-100), status: "TRIAL" } })).id;
    return undefined;
  };
  await family("F1", "Valiyevlar", "998901110001");
  await family("F2", "Karimovlar", "998901110002");
  await family("F3", "Toshmatovlar", "998901110003");
  await family("F4", "Yusupovlar", "998901110004");
  await family("F5", "Sobirovlar", "998901110005");
  await student("s1", "F1", "Ali", "Valiyev", C.A, C.gA, "998931230001");
  await student("s2", "F2", "Vali", "Karimov", C.B, C.gB);
  await student("s3", "F2", "Ali", "Karimova", C.B, C.gA); // home B, enrolled in A → family visible to branch A
  await student("s4", "F3", "Olim", "Toshmatov", C.B, C.gB);
  await student("s5", "F4", "Bek", "Yusupov", null);
  await student("s6", "F5", "Sardor", "Sobirov", C.B, C.gB); // only branch B
  const id = C.center;
  // trial enrollments and charges without enrollmentId: the nightly billing sync (other test files) leaves them alone
  // F1: 3 × 300k charges, 400k paid → k1 paid, k2 200k due (45 days), k3 300k due (10 days); debt 500k
  await entry(id, C.fam.F1, "CHARGE", -300_000, day(-90), { key: "k1" });
  await entry(id, C.fam.F1, "CHARGE", -300_000, day(-45), { key: "k2" });
  await entry(id, C.fam.F1, "CHARGE", -300_000, day(-10), { key: "k3" });
  await entry(id, C.fam.F1, "PAYMENT", 400_000, day(-5), { method: "CASH" });
  // F2: 200k due for 70 days; F3: paid off; F4: 50k (3 days); F5: 70k (2 days)
  await entry(id, C.fam.F2, "CHARGE", -200_000, day(-70), { key: "k4" });
  await entry(id, C.fam.F3, "CHARGE", -100_000, day(-20), { key: "k5" });
  await entry(id, C.fam.F3, "PAYMENT", 100_000, day(-19), { method: "CARD" });
  await entry(id, C.fam.F4, "CHARGE", -50_000, day(-3), { key: "k6" });
  await entry(id, C.fam.F5, "CHARGE", -70_000, day(-2), { key: "k7" });
}

// ------------------------------------------------------------------ center R: revenue, B12, B13
const R = { center: "", RA: "", RB: "", owner: "", fam: {} as Record<string, string>, st: {} as Record<string, string> };
/** Every money-ish row of center R: [family, type, amount, date, method, studentKey?, counts as revenue?] */
const rMoney: { fam: string; type: LedgerType; amount: number; date: string; method?: PaymentMethod; student?: string; counts: boolean; branch?: string; reverses?: number }[] = [];

async function buildR() {
  const center = await db.center.create({ data: { name: "RQ revenue", slug: "rq-revenue" } });
  R.center = center.id;
  R.RA = (await db.branch.create({ data: { centerId: center.id, name: "RA" } })).id;
  R.RB = (await db.branch.create({ data: { centerId: center.id, name: "RB" } })).id;
  R.owner = (await staff(center.id, "998955500011", "OWNER")).id;
  const t = await staff(center.id, "998955500012", "TEACHER", [R.RA, R.RB]);
  const course = await db.course.create({ data: { centerId: center.id, name: "Math", pricingType: "SUBSCRIPTION", price: 100_000 } });
  const gRA = await db.group.create({ data: { centerId: center.id, branchId: R.RA, courseId: course.id, teacherId: t.id, code: 1, name: "RA-1", startDate: fromISODate("2025-12-01") } });
  const gRB = await db.group.create({ data: { centerId: center.id, branchId: R.RB, courseId: course.id, teacherId: t.id, code: 2, name: "RB-1", startDate: fromISODate("2025-12-01") } });
  const old = new Date("2025-01-01T00:00:00Z");
  for (const [key, name] of [["G1", "G1"], ["G2", "G2"], ["G3", "G3"]]) R.fam[key] = (await db.family.create({ data: { centerId: center.id, name } })).id;
  const student = async (key: string, fam: string, branchId: string | null, createdAt: Date, enroll?: { groupId: string; start: string }) => {
    R.st[key] = (await db.student.create({ data: { centerId: center.id, familyId: R.fam[fam], firstName: key, lastName: fam, branchId, createdAt } })).id;
    if (enroll) await db.enrollment.create({ data: { studentId: R.st[key], groupId: enroll.groupId, startDate: fromISODate(enroll.start), status: "TRIAL" } });
  };
  // G1: RB student has the most recent open enrollment → family-level money goes to RB (B12)
  await student("r1", "G1", R.RA, old, { groupId: gRA.id, start: "2026-01-10" });
  await student("r2", "G1", R.RB, new Date("2025-02-01T00:00:00Z"), { groupId: gRB.id, start: "2026-02-01" });
  // G2: same start dates → the earlier-created student (RA) wins
  await student("r3", "G2", R.RA, old, { groupId: gRA.id, start: "2026-01-05" });
  await student("r4", "G2", R.RB, new Date("2025-03-01T00:00:00Z"), { groupId: gRB.id, start: "2026-01-05" });
  // G3: no student with a branch → "-"
  await student("r5", "G3", null, old);
  // B13: created 23:59 Oct 31 and 01:00 Nov 1 in Tashkent
  await student("late-oct", "G3", null, new Date("2026-10-31T18:59:00Z"));
  await student("early-nov", "G3", null, new Date("2026-10-31T20:00:00Z"));
  await db.lead.create({ data: { centerId: center.id, name: "Nov lead", phone: "998900000001", createdAt: new Date("2026-10-31T20:00:00Z") } });
  await db.lead.create({ data: { centerId: center.id, name: "Oct lead", phone: "998900000002", createdAt: new Date("2026-10-31T18:59:00Z") } });

  const thisMonth = today.slice(0, 7);
  rMoney.push(
    { fam: "G1", type: "PAYMENT", amount: 100_000, date: "2026-03-05", method: "CASH", counts: true, branch: "RB" },
    { fam: "G1", type: "PAYMENT", amount: 50_000, date: "2026-03-06", method: "CARD", student: "r1", counts: true, branch: "RA" },
    { fam: "G2", type: "PAYMENT", amount: 70_000, date: "2026-03-10", method: "TRANSFER", counts: true, branch: "RA" },
    { fam: "G3", type: "PAYMENT", amount: 30_000, date: "2026-03-11", method: "CASH", counts: true, branch: "-" },
    { fam: "G1", type: "REFUND", amount: -20_000, date: "2026-03-12", method: "CASH", counts: true, branch: "RB" },
    { fam: "G2", type: "PAYMENT", amount: 40_000, date: "2026-03-15", method: "CASH", counts: true, branch: "RA" },
    { fam: "G2", type: "REVERSAL", amount: -40_000, date: "2026-03-16", method: "CASH", counts: true, branch: "RA", reverses: 5 },
    { fam: "G1", type: "CHARGE", amount: -500_000, date: "2026-03-01", counts: false },
    { fam: "G1", type: "REVERSAL", amount: 500_000, date: "2026-03-02", counts: false, reverses: 7 },
    { fam: "G1", type: "PAYMENT", amount: 999, date: "2026-04-01", method: "CASH", counts: true, branch: "RB" },
    { fam: "G1", type: "PAYMENT", amount: 11_000, date: `${thisMonth}-01`, method: "CASH", counts: true, branch: "RB" },
    { fam: "G2", type: "PAYMENT", amount: 22_000, date: `${shiftMonth(thisMonth, -2)}-15`, method: "CARD", counts: true, branch: "RA" },
  );
  const ids: string[] = [];
  for (const m of rMoney) {
    const row = await entry(R.center, R.fam[m.fam], m.type, m.amount, fromISODate(m.date), { method: m.method, studentId: m.student ? R.st[m.student] : undefined, reversesId: m.reverses !== undefined ? ids[m.reverses] : undefined, key: m.type === "CHARGE" ? "rk" : undefined });
    ids.push(row.id);
  }
}

beforeAll(async () => {
  await buildC();
  await buildR();
});

describe("debtors (P1)", () => {
  it("lists families with a negative balance, biggest debt first, with FIFO days overdue", async () => {
    const all = await listAllDebtors(await ctxOf(C.owner), {});
    expect(all.map((r) => [r.familyId, r.debt])).toEqual([
      [C.fam.F1, 500_000],
      [C.fam.F2, 200_000],
      [C.fam.F5, 70_000],
      [C.fam.F4, 50_000],
    ]);
    const f1 = all[0];
    expect(f1.daysOverdue).toBe(45); // k1 paid by the 400k, k2 is the oldest unpaid
    expect(f1.lastPayment).toBe(addDays(today, -5));
    expect(f1.phone).toBe("998901110001");
    expect(all[1].daysOverdue).toBe(70);
  });

  it("paginates in SQL with totals over every page; a page past the end shows the last one", async () => {
    const ctx = await ctxOf(C.owner);
    const p1 = await listDebtors(ctx, {}, { page: 1, pageSize: 3 });
    expect(p1).toMatchObject({ total: 4, totalDebt: 820_000, page: 1, pages: 2 });
    expect(p1.rows.map((r) => r.familyId)).toEqual([C.fam.F1, C.fam.F2, C.fam.F5]);
    const p2 = await listDebtors(ctx, {}, { page: 9, pageSize: 3 });
    expect(p2.page).toBe(2);
    expect(p2.rows.map((r) => r.familyId)).toEqual([C.fam.F4]);
  });

  it("filters by minimum, group and teacher", async () => {
    const ctx = await ctxOf(C.owner);
    const ids = async (f: object) => (await listDebtors(ctx, f)).rows.map((r) => r.familyId);
    expect(await ids({ min: "100 000" })).toEqual([C.fam.F1, C.fam.F2]);
    expect(await ids({ groupId: C.gA })).toEqual([C.fam.F1, C.fam.F2]);
    expect(await ids({ teacherId: C.tb })).toEqual([C.fam.F2, C.fam.F5]);
  });

  it("respects branch scope — also together with a teacher filter", async () => {
    const admin = await ctxOf(C.adminA);
    expect((await listDebtors(admin, {})).rows.map((r) => r.familyId)).toEqual([C.fam.F1, C.fam.F2]);
    // F5 learns only in branch B: a branch-A admin filtering by B's teacher must not see it
    expect((await listDebtors(admin, { teacherId: C.tb })).rows.map((r) => r.familyId)).toEqual([C.fam.F2]);
    const ownerOnB = await ctxOf(C.owner, C.B);
    expect((await listDebtors(ownerOnB, {})).rows.map((r) => r.familyId)).toEqual([C.fam.F2, C.fam.F5]);
  });

  it("students?debt=1 matches the debtor families", async () => {
    const { ids, total } = await studentIds(await ctxOf(C.owner), { debt: true }, { skip: 0, take: 50 });
    expect(new Set(ids)).toEqual(new Set([C.st.s1, C.st.s2, C.st.s3, C.st.s5, C.st.s6]));
    expect(total).toBe(5);
  });
});

describe("debt aging", () => {
  it("buckets each unpaid charge by age after FIFO allocation", async () => {
    expect(await debtAging(await ctxOf(C.owner))).toEqual({ total: 820_000, buckets: [420_000, 200_000, 200_000], families: 4 });
    expect(await debtAging(await ctxOf(C.adminA))).toEqual({ total: 700_000, buckets: [300_000, 200_000, 200_000], families: 2 });
  });
});

describe("revenue in SQL (P2, B12)", () => {
  it("sums money by method and branch; charges and their reversals never count", async () => {
    const ctx = await ctxOf(R.owner);
    const r = await revenue(ctx, { from: "2026-03-01", to: "2026-03-31" });
    expect(r.total).toBe(230_000);
    expect(Object.fromEntries(r.byMethod)).toEqual({ CASH: 110_000, CARD: 50_000, TRANSFER: 70_000 });
    // family-level money: G1 → RB (latest open enrollment), G2 → RA (tie → earlier student), G3 → "-"
    expect(Object.fromEntries(r.byBranch)).toEqual({ [R.RA]: 120_000, [R.RB]: 80_000, "-": 30_000 });
  });

  it("revenueByMonth equals the per-month sums of the fixture", async () => {
    const ctx = await ctxOf(R.owner);
    const now = today.slice(0, 7);
    const expected = Array.from({ length: 6 }, (_, i) => {
      const month = shiftMonth(now, i - 5);
      const { start, end } = monthRange(month);
      return { month, total: rMoney.filter((m) => m.counts && m.date >= start && m.date <= end).reduce((s, m) => s + m.amount, 0) };
    });
    expect(await revenueByMonth(ctx, 6)).toEqual(expected);
    expect(expected[5].total).toBeGreaterThanOrEqual(11_000);
  });
});

describe("Tashkent month boundaries (B13)", () => {
  it("a record created 2026-10-31T20:00Z (01:00 Nov 1 in Tashkent) counts in November", async () => {
    const ctx = await ctxOf(R.owner);
    const nov = { from: "2026-11-01", to: "2026-11-30" };
    const oct = { from: "2026-10-01", to: "2026-10-31" };
    expect((await studentStats(ctx, nov)).newStudents).toBe(1);
    expect((await studentStats(ctx, oct)).newStudents).toBe(1);
    expect((await leadFunnel(ctx, nov)).total).toBe(1);
    expect((await leadFunnel(ctx, oct)).total).toBe(1);
  });
});

describe("student search on trigram-friendly SQL (P4)", () => {
  const prismaIds = async (q: string) =>
    (await db.student.findMany({ where: { AND: [{ centerId: C.center }, studentSearch(q)] }, select: { id: true } })).map((s) => s.id).sort();

  it("agrees with the Prisma filter and ANDs the words of a full name", async () => {
    const ctx = await ctxOf(C.owner);
    for (const q of ["ali", "Ali Valiyev", "valiyev ali", "karim", "1110002", "93123", "nobody here", "xy 1110001"]) {
      const { ids } = await studentIds(ctx, { q });
      expect([...ids].sort(), q).toEqual(await prismaIds(q));
    }
    expect((await studentIds(ctx, { q: "Ali Valiyev" })).ids).toEqual([C.st.s1]);
    // "ali" is also inside "Vali": order is last name, first name
    expect((await studentIds(ctx, { q: "ali" })).ids).toEqual([C.st.s2, C.st.s3, C.st.s1]);
    // guardian phone finds every child of that family
    expect((await studentIds(ctx, { q: "90 111 00 02" })).ids.sort()).toEqual([C.st.s2, C.st.s3].sort());
  });

  it("takes LIKE wildcards literally", async () => {
    expect((await studentIds(await ctxOf(C.owner), { q: "a%i" })).ids).toEqual([]);
  });
});

describe("unknown query values are ignored (B14)", () => {
  it("payments ?method=BOGUS lists like no method filter instead of failing", async () => {
    const ctx = await ctxOf(C.owner);
    const f = { from: addDays(today, -100), to: today };
    const all = await listPayments(ctx, f);
    const bogus = await listPayments(ctx, { ...f, method: "BOGUS" });
    expect(bogus.total).toBe(all.total);
    expect(all.total).toBe(2);
    expect((await listPayments(ctx, { ...f, method: "CASH" })).total).toBe(1);
  });
});

describe("audit journal (P5)", () => {
  it("hides billing.sync, pages newest first, and counts only a bounded window ahead", async () => {
    const base = Date.now() - 10 * 86_400_000;
    await db.auditLog.createMany({
      data: [
        ...Array.from({ length: 1200 }, (_, i) => ({ centerId: C.center, entity: "Student", entityId: `s${i}`, action: "update", createdAt: new Date(base + i * 1000) })),
        ...Array.from({ length: 30 }, (_, i) => ({ centerId: C.center, entity: "Enrollment", entityId: `e${i}`, action: "billing.sync", createdAt: new Date(base + i * 1000 + 500) })),
      ],
    });
    const ctx = await ctxOf(C.owner);
    const p1 = await listAudit(ctx, {}, 1);
    expect(p1.rows).toHaveLength(50);
    expect(p1.rows.every((r) => r.action !== "billing.sync")).toBe(true);
    expect(p1.rows[0].entityId).toBe("s1199");
    expect(p1).toMatchObject({ total: 1050, exact: false });
    const p20 = await listAudit(ctx, {}, 20);
    expect(p20).toMatchObject({ total: 1200, exact: true });
    expect(p20.rows.map((r) => r.entityId)).toEqual(Array.from({ length: 50 }, (_, i) => `s${249 - i}`));
    expect((await listAudit(ctx, { sync: "1" }, 30)).total).toBe(1230);
    expect((await listAudit(ctx, { action: "billing" }, 1)).total).toBe(30);
  });
});
