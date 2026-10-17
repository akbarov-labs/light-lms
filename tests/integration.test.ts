// DB integration tests on top of the demo seed. Run: npm run test:integration
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { seedDemo } from "../prisma/seed-demo";
import { addDays, fromISODate, monthRange, shiftMonth, todayISO, toISODate } from "@/lib/dates";
import { billingSync } from "@/worker/jobs";
import { syncEnrollment, loadBillingInput } from "@/lib/billing/sync";
import { computeExpected } from "@/lib/billing/engine";
import { transferEnrollment, enrollStudent, activateEnrollment } from "@/lib/services/enrollments";
import { reversePayment, takePayment } from "@/lib/services/payments";
import { familyBalance } from "@/lib/services/wallet";
import { liveSalary, lockPayslip, addAdjustment, markPayslipPaid } from "@/lib/salary/service";
import { saveAttendance } from "@/lib/services/attendance";
import { handlePayme } from "@/lib/payments/payme";
import { prismaPaymeRepo } from "@/lib/payments/payme-repo";
import { assertFamilyAccess, assertStudentAccess, buildCtx, loadUser } from "@/lib/ctx-core";
import { UserError } from "@/lib/user-error";

const today = todayISO();
let centerId = "";
let owner = { userId: "", centerId: "" };

async function ctxFor(phone: string) {
  const u = await db.user.findUniqueOrThrow({ where: { phone } });
  return buildCtx((await loadUser(u.id))!);
}

beforeAll(async () => {
  await seedDemo();
  const c = await db.center.findUniqueOrThrow({ where: { slug: "demo" } });
  centerId = c.id;
  const o = await db.user.findUniqueOrThrow({ where: { phone: "998901234567" } });
  owner = { userId: o.id, centerId };
});

describe("billing on the database", () => {
  it("the seeded ledger already equals what the engine expects (nothing left to post)", async () => {
    // the job syncs every center; other test files may have left unsynced enrollments elsewhere,
    // so "nothing to post" is checked on the demo center only
    const before = await db.ledgerEntry.count({ where: { centerId } });
    const res = await billingSync(today);
    expect(res.syncFailed).toBe(0);
    expect(await db.ledgerEntry.count({ where: { centerId } })).toBe(before);
  });

  it("running sync again and again posts nothing", async () => {
    const e = await db.enrollment.findFirstOrThrow({ where: { status: "ACTIVE", endDate: null } });
    for (let i = 0; i < 3; i++) expect(await syncEnrollment(e.id)).toEqual([]);
  });

  it("ledger per enrollment matches the engine's expected total", async () => {
    const enrollments = await db.enrollment.findMany({ where: { activatedAt: { not: null } }, take: 20 });
    for (const e of enrollments) {
      const { input } = await loadBillingInput(db, e.id, today);
      const expected = computeExpected(input).reduce((s, u) => s + u.amount, 0);
      const posted = await db.ledgerEntry.aggregate({ where: { enrollmentId: e.id, type: { in: ["CHARGE", "CREDIT"] } }, _sum: { amount: true } });
      expect(-(posted._sum.amount ?? 0)).toBe(expected);
    }
  });

  it("transfer closes the old row, opens the new one and re-prices both", async () => {
    const ge1 = await db.group.findFirstOrThrow({ where: { centerId, name: "GE-A1 ertalab" } });
    const ge2 = await db.group.findFirstOrThrow({ where: { centerId, name: "GE-A1 kechki" } });
    const e = await db.enrollment.findFirstOrThrow({ where: { groupId: ge1.id, status: "ACTIVE", endDate: null, student: { enrollments: { none: { groupId: ge2.id, endDate: null } } } } });
    const move = addDays(today, 1);
    const newId = await transferEnrollment(owner, e.id, ge2.id, move);
    const old = await db.enrollment.findUniqueOrThrow({ where: { id: e.id } });
    expect(old).toMatchObject({ status: "TRANSFERRED", transferredToId: newId });
    expect(toISODate(old.endDate!)).toBe(today);
    for (const id of [e.id, newId]) {
      const { input } = await loadBillingInput(db, id, today);
      const expected = computeExpected(input).reduce((s, u) => s + u.amount, 0);
      const posted = await db.ledgerEntry.aggregate({ where: { enrollmentId: id, type: { in: ["CHARGE", "CREDIT"] } }, _sum: { amount: true } });
      expect(-(posted._sum.amount ?? 0)).toBe(expected);
    }
    // the partial unique index keeps one open row per student per group
    await expect(db.enrollment.create({ data: { studentId: e.studentId, groupId: ge2.id, startDate: fromISODate(today) } })).rejects.toThrow();
  });

  it("trial → activate charges the current period pro-rated", async () => {
    const g = await db.group.findFirstOrThrow({ where: { centerId, name: "GE-A1 Yunusobod" } });
    const s = await db.student.findFirstOrThrow({ where: { centerId, enrollments: { none: { groupId: g.id } } } });
    const id = await enrollStudent(owner, { studentId: s.id, groupId: g.id, startDate: today, trial: true });
    expect(await db.ledgerEntry.count({ where: { enrollmentId: id } })).toBe(0);
    await activateEnrollment(owner, id);
    const charge = await db.ledgerEntry.findFirstOrThrow({ where: { enrollmentId: id, type: "CHARGE" } });
    expect(charge.amount).toBeLessThan(0);
    expect(-charge.amount).toBeLessThanOrEqual(600_000);
  });
});

describe("payments", () => {
  it("payment lowers debt, reversal restores it, a second reversal is refused", async () => {
    const fam = await db.family.findFirstOrThrow({ where: { centerId } });
    const before = await familyBalance(fam.id);
    const p = await takePayment(owner, { familyId: fam.id, amount: 250_000, method: "CASH" });
    expect(await familyBalance(fam.id)).toBe(before + 250_000);
    expect(p.receiptNo).toBeGreaterThan(0);
    await reversePayment(owner, p.id, "test");
    expect(await familyBalance(fam.id)).toBe(before);
    await expect(reversePayment(owner, p.id, "again")).rejects.toThrow(UserError);
    // the original row is never edited
    expect((await db.ledgerEntry.findUniqueOrThrow({ where: { id: p.id } })).amount).toBe(250_000);
  });

  it("payment report counts only money, never charges/credits", async () => {
    const r = monthRange(today.slice(0, 7));
    const rows = await db.ledgerEntry.groupBy({ by: ["type"], where: { centerId, date: { gte: fromISODate(r.start), lte: fromISODate(r.end) } }, _sum: { amount: true } });
    const { revenue } = await import("@/lib/queries/reports");
    const ctx = await ctxFor("998901234567");
    const rev = await revenue(ctx, { from: r.start, to: r.end });
    const money = rows.filter((x) => x.type === "PAYMENT" || x.type === "REFUND").reduce((s, x) => s + (x._sum.amount ?? 0), 0);
    const reversalsOfMoney = await db.ledgerEntry.aggregate({ where: { centerId, type: "REVERSAL", reverses: { type: { in: ["PAYMENT", "REFUND"] } }, date: { gte: fromISODate(r.start), lte: fromISODate(r.end) } }, _sum: { amount: true } });
    expect(rev.total).toBe(money + (reversalsOfMoney._sum.amount ?? 0));
  });
});

describe("salary", () => {
  it("last month is locked and paid, with a salary expense", async () => {
    const lastMonth = shiftMonth(today.slice(0, 7), -1);
    const slips = await db.payslip.findMany({ where: { month: lastMonth, teacher: { centerId } } });
    expect(slips.length).toBe(4);
    for (const s of slips) {
      expect(s.status).toBe("PAID");
      expect(await db.expense.findUniqueOrThrow({ where: { id: s.expenseId! } })).toMatchObject({ amount: s.total, category: "Oylik / Salary" });
    }
  });

  it("lock freezes the numbers: later changes move the live total, not the payslip", async () => {
    const aziza = await db.user.findUniqueOrThrow({ where: { phone: "998901234571" } });
    const month = today.slice(0, 7);
    await lockPayslip(owner, aziza.id, month);
    const locked = await db.payslip.findUniqueOrThrow({ where: { teacherId_month: { teacherId: aziza.id, month } } });
    expect(locked.status).toBe("LOCKED");
    await expect(addAdjustment(owner, aziza.id, month, 100_000, "x")).rejects.toThrow(UserError);
    // a lesson that was missing attendance gets marked after the lock → live changes, payslip doesn't
    const lesson = await db.lesson.findFirst({ where: { teacherId: aziza.id, status: "SCHEDULED", date: { gte: fromISODate(monthRange(month).start), lte: fromISODate(today) } } });
    if (lesson) {
      const enr = await db.enrollment.findFirst({ where: { groupId: lesson.groupId, activatedAt: { not: null, lte: lesson.date }, endDate: null } });
      if (enr) await saveAttendance(owner, lesson.id, [{ studentId: enr.studentId, status: "PRESENT" }]);
    }
    const live = await liveSalary(centerId, aziza.id, month);
    const after = await db.payslip.findUniqueOrThrow({ where: { teacherId_month: { teacherId: aziza.id, month } } });
    expect(after.total).toBe(locked.total);
    if (lesson) expect(live.result.total).toBeGreaterThanOrEqual(locked.total);
    await markPayslipPaid(owner, aziza.id, month);
    expect((await db.payslip.findUniqueOrThrow({ where: { id: locked.id } })).status).toBe("PAID");
  });
});

describe("Payme on the database", () => {
  it("create → perform posts one PAYMENT; cancel posts the REVERSAL", async () => {
    await db.center.update({ where: { id: centerId }, data: { paymeMerchantId: "m-test", paymeKey: "k-test" } });
    const fam = await db.family.findFirstOrThrow({ where: { centerId } });
    const before = await familyBalance(fam.id);
    const auth = `Basic ${Buffer.from("Paycom:k-test").toString("base64")}`;
    const rpc = (method: string, params: object, now = Date.now()) => handlePayme({ auth, body: JSON.stringify({ id: 1, method, params }) }, prismaPaymeRepo, now);
    const t0 = Date.now();
    expect((await rpc("CheckPerformTransaction", { amount: 30_000_000, account: { family_id: fam.id } })).result).toEqual({ allow: true });
    expect((await rpc("CreateTransaction", { id: "pm-1", time: t0, amount: 30_000_000, account: { family_id: fam.id } }, t0)).result).toMatchObject({ state: 1 });
    expect((await rpc("PerformTransaction", { id: "pm-1" }, t0 + 1000)).result).toMatchObject({ state: 2 });
    expect((await rpc("PerformTransaction", { id: "pm-1" }, t0 + 2000)).result).toMatchObject({ state: 2, perform_time: t0 + 1000 });
    expect(await familyBalance(fam.id)).toBe(before + 300_000);
    expect(await db.ledgerEntry.count({ where: { externalId: "pm-1", type: "PAYMENT", method: "PAYME" } })).toBe(1);
    expect((await rpc("CancelTransaction", { id: "pm-1", reason: 5 }, t0 + 3000)).result).toMatchObject({ state: -2 });
    expect((await rpc("CancelTransaction", { id: "pm-1", reason: 5 }, t0 + 4000)).result).toMatchObject({ state: -2, cancel_time: t0 + 3000 });
    expect(await familyBalance(fam.id)).toBe(before);
    expect((await rpc("CheckTransaction", { id: "pm-1" })).result).toMatchObject({ state: -2, reason: 5 });
    // wrong key
    const bad = await handlePayme({ auth: `Basic ${Buffer.from("Paycom:nope").toString("base64")}`, body: JSON.stringify({ id: 2, method: "CheckTransaction", params: { id: "pm-1" } }) }, prismaPaymeRepo);
    expect(bad.error?.code).toBe(-32504);
  });

  it("two concurrent CreateTransaction calls for one id both answer the same transaction (L8)", async () => {
    await db.center.update({ where: { id: centerId }, data: { paymeMerchantId: "m-test", paymeKey: "k-test" } });
    const fam = await db.family.findFirstOrThrow({ where: { centerId } });
    const auth = `Basic ${Buffer.from("Paycom:k-test").toString("base64")}`;
    const t0 = Date.now();
    const create = () => handlePayme({ auth, body: JSON.stringify({ id: 1, method: "CreateTransaction", params: { id: "pm-race", time: t0, amount: 10_000_000, account: { family_id: fam.id } } }) }, prismaPaymeRepo, t0);
    // slow inserts down so both calls are past their "does it exist?" read before either row is committed
    await db.$executeRawUnsafe(`CREATE OR REPLACE FUNCTION test_slow_payme() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN PERFORM pg_sleep(0.3); RETURN NEW; END $$`);
    await db.$executeRawUnsafe(`CREATE TRIGGER test_slow_payme BEFORE INSERT ON "PaymeTransaction" FOR EACH ROW EXECUTE FUNCTION test_slow_payme()`);
    try {
      const [a, b] = await Promise.all([create(), create()]);
      expect(a.error).toBeUndefined();
      expect(b.error).toBeUndefined();
      expect(a.result).toMatchObject({ state: 1, create_time: t0 });
      expect(b.result).toEqual(a.result);
    } finally {
      await db.$executeRawUnsafe(`DROP TRIGGER IF EXISTS test_slow_payme ON "PaymeTransaction"`);
      await db.$executeRawUnsafe(`DROP FUNCTION IF EXISTS test_slow_payme()`);
    }
    expect(await db.paymeTransaction.count({ where: { paymeId: "pm-race" } })).toBe(1);
  });

  it("GetStatement selects and orders by Payme's own time, not ours (L5)", async () => {
    await db.center.update({ where: { id: centerId }, data: { paymeMerchantId: "m-test", paymeKey: "k-test" } });
    const fam = await db.family.findFirstOrThrow({ where: { centerId } });
    const auth = `Basic ${Buffer.from("Paycom:k-test").toString("base64")}`;
    const rpc = (method: string, params: object, now: number) => handlePayme({ auth, body: JSON.stringify({ id: 1, method, params }) }, prismaPaymeRepo, now);
    // Payme's clock is behind ours: "time" is 10 min before our create time, and the order differs
    const base = Date.UTC(2031, 0, 1);
    await rpc("CreateTransaction", { id: "pm-st-a", time: base - 600_000 + 20, amount: 10_000_000, account: { family_id: fam.id } }, base);
    await rpc("CreateTransaction", { id: "pm-st-b", time: base - 600_000 + 10, amount: 10_000_000, account: { family_id: fam.id } }, base + 1);
    const list = async (from: number, to: number) => ((await rpc("GetStatement", { from, to }, base + 5)).result as { transactions: { id: string; time: number }[] }).transactions;
    expect((await list(base - 600_000, base - 590_000)).map((t) => [t.id, t.time])).toEqual([
      ["pm-st-b", base - 600_000 + 10],
      ["pm-st-a", base - 600_000 + 20],
    ]);
    expect(await list(base, base + 10)).toEqual([]);
  });
});

describe("data isolation", () => {
  it("a user of one center cannot reach another center's family or student", async () => {
    const other = await db.center.create({ data: { name: "Boshqa markaz", slug: "other-center" } });
    const fam = await db.family.create({ data: { centerId: other.id, name: "Begona oila" } });
    const st = await db.student.create({ data: { centerId: other.id, familyId: fam.id, firstName: "X", lastName: "Y" } });
    const ownerCtx = await ctxFor("998901234567");
    await expect(assertFamilyAccess(ownerCtx, fam.id)).rejects.toThrow(UserError);
    await expect(assertStudentAccess(ownerCtx, st.id)).rejects.toThrow(UserError);
  });

  it("a branch-scoped admin cannot reach a student who only belongs to another branch", async () => {
    const adminCtx = await ctxFor("998901234569"); // Chilonzor only
    const yunusobod = await db.branch.findFirstOrThrow({ where: { centerId, name: "Yunusobod" } });
    const st = await db.student.findFirstOrThrow({
      where: { centerId, branchId: yunusobod.id, enrollments: { every: { group: { branchId: yunusobod.id } } } },
    });
    await expect(assertStudentAccess(adminCtx, st.id)).rejects.toThrow(UserError);
    const chilonzor = await db.student.findFirstOrThrow({ where: { centerId, enrollments: { some: { group: { branch: { name: "Chilonzor" } } } } } });
    await expect(assertStudentAccess(adminCtx, chilonzor.id)).resolves.toBeUndefined();
  });

  it("admins do not get refund/reversal permission by default; the cashier only takes payments", async () => {
    const admin = await ctxFor("998901234569");
    const cashier = await ctxFor("998901234570");
    expect(admin.can("payments.refund")).toBe(false);
    expect(cashier.can("payments.take")).toBe(true);
    expect(cashier.can("leads")).toBe(false);
  });
});
