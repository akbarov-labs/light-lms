import { describe, expect, it } from "vitest";
import { FakeLedger, scenario, withStatus } from "@/lib/billing/testkit";
import { allocate, type AllocEntry } from "@/lib/billing/allocation";
import { computeExpected } from "@/lib/billing/engine";
import type { BillingInput } from "@/lib/billing/types";
import { collectLessons, computeSalary, type LessonRow, type SalaryRule } from "./engine";

// One group, Mon/Wed/Fri, October 2026 = 13 lessons; two students at 600 000/month (46 153.8 per lesson each).
function setup(opts: { trialSecond?: boolean; asOf?: string } = {}) {
  const a = scenario({ asOf: opts.asOf ?? "2026-10-31", enrollment: { id: "eA" } });
  const b = scenario({ asOf: opts.asOf ?? "2026-10-31", enrollment: opts.trialSecond ? { id: "eB", status: "TRIAL", activatedAt: null } : { id: "eB" } });
  let inputA: BillingInput = a;
  let inputB: BillingInput = { ...b, lessons: a.lessons };
  // first 4 October lessons held (2, 5, 7, 9); the 9th taught by a substitute
  for (const d of ["2026-10-02", "2026-10-05", "2026-10-07", "2026-10-09"]) {
    inputA = withStatus(inputA, d, "HELD");
    inputB = withStatus(inputB, d, "HELD");
  }
  const lessons: LessonRow[] = inputA.lessons.map((l) => ({
    id: l.id,
    date: l.date,
    status: l.status,
    teacherId: l.date === "2026-10-09" ? "sub" : "T",
    groupId: "g1",
    groupName: "GE-A1",
  }));
  const enrollmentsByGroup = new Map([["g1", [{ input: inputA, studentName: "A" }, { input: inputB, studentName: "B" }]]]);
  return { lessons, enrollmentsByGroup };
}

const per = 600_000 / 13;
const rule = (r: Partial<SalaryRule>): SalaryRule => ({ model: "PERCENT_EARNED", percent: null, fixedAmount: null, perLesson: null, ...r });

describe("salary", () => {
  it("% of earned tuition for lessons actually held", () => {
    const { lessons, enrollmentsByGroup } = setup();
    const held = collectLessons({ teacherId: "T", month: "2026-10", lessons, enrollmentsByGroup, payTrial: false, paidKeys: new Set() });
    expect(held).toHaveLength(3);
    const r = computeSalary({ rule: rule({ percent: 40 }), lessons: held, adjustments: [], payFromCollected: false });
    expect(r.lines[0]).toMatchObject({ lessonsHeld: 3, studentLessons: 6 });
    expect(r.total).toBe(Math.round(per * 6 * 0.4));
  });

  it("substitute teacher gets the lesson", () => {
    const { lessons, enrollmentsByGroup } = setup();
    const held = collectLessons({ teacherId: "sub", month: "2026-10", lessons, enrollmentsByGroup, payTrial: false, paidKeys: new Set() });
    expect(held.map((l) => l.date)).toEqual(["2026-10-09"]);
    expect(computeSalary({ rule: rule({ model: "PER_LESSON", perLesson: 80_000 }), lessons: held, adjustments: [], payFromCollected: false }).total).toBe(80_000);
  });

  it("fixed, per lesson and base + %", () => {
    const { lessons, enrollmentsByGroup } = setup();
    const held = collectLessons({ teacherId: "T", month: "2026-10", lessons, enrollmentsByGroup, payTrial: false, paidKeys: new Set() });
    expect(computeSalary({ rule: rule({ model: "FIXED", fixedAmount: 3_000_000 }), lessons: held, adjustments: [], payFromCollected: false }).total).toBe(3_000_000);
    expect(computeSalary({ rule: rule({ model: "PER_LESSON", perLesson: 100_000 }), lessons: held, adjustments: [], payFromCollected: false }).total).toBe(300_000);
    expect(computeSalary({ rule: rule({ model: "BASE_PLUS_PERCENT", fixedAmount: 1_000_000, percent: 20 }), lessons: held, adjustments: [], payFromCollected: false }).total).toBe(
      1_000_000 + Math.round(per * 6 * 0.2),
    );
  });

  it("trial students are excluded unless the setting is on", () => {
    const { lessons, enrollmentsByGroup } = setup({ trialSecond: true });
    const off = collectLessons({ teacherId: "T", month: "2026-10", lessons, enrollmentsByGroup, payTrial: false, paidKeys: new Set() });
    expect(off.every((l) => l.students.length === 1)).toBe(true);
    const on = collectLessons({ teacherId: "T", month: "2026-10", lessons, enrollmentsByGroup, payTrial: true, paidKeys: new Set() });
    expect(on.every((l) => l.students.length === 2)).toBe(true);
    expect(on[0].students.find((s) => s.trial)?.value).toBeCloseTo(per);
  });

  it("pay only from collected money counts only paid billing units", () => {
    const { lessons, enrollmentsByGroup } = setup();
    const held = collectLessons({ teacherId: "T", month: "2026-10", lessons, enrollmentsByGroup, payTrial: false, paidKeys: new Set(["sub:eA:2026-10-01"]) });
    const off = computeSalary({ rule: rule({ percent: 50 }), lessons: held, adjustments: [], payFromCollected: false });
    const on = computeSalary({ rule: rule({ percent: 50 }), lessons: held, adjustments: [], payFromCollected: true });
    expect(off.lines[0].studentLessons).toBe(6);
    expect(on.lines[0].studentLessons).toBe(3);
    expect(on.total).toBe(Math.round(per * 3 * 0.5));
  });

  it("pay from collected with installments: a lesson counts only when its installment and every earlier one are paid", () => {
    // Python Foundation: 2 400 000 whole course (Sep–Dec, Mon/Wed/Fri) in 4 monthly installments of 600 000
    let input = scenario({
      asOf: "2026-12-31",
      groupStart: "2026-09-01",
      groupEnd: "2026-12-31",
      course: { pricingType: "PACKAGE", price: 2_400_000, packageLessons: null, installments: 4 },
      enrollment: { startDate: "2026-09-01", activatedAt: "2026-09-01" },
    });
    for (const l of input.lessons) input = withStatus(input, l.date, "HELD");
    const lessons: LessonRow[] = input.lessons.map((l) => ({ id: l.id, date: l.date, status: l.status, teacherId: "T", groupId: "g1", groupName: "PY" }));
    const enrollmentsByGroup = new Map([["g1", [{ input, studentName: "A" }]]]);
    const total = input.lessons.length;
    const run = (month: string, paid: string[]) => {
      const held = collectLessons({ teacherId: "T", month, lessons, enrollmentsByGroup, payTrial: false, paidKeys: new Set(paid) });
      return computeSalary({ rule: rule({ percent: 10 }), lessons: held, adjustments: [], payFromCollected: true }).lines[0];
    };
    const sep = input.lessons.filter((l) => l.date.startsWith("2026-09")).length;
    const oct = input.lessons.filter((l) => l.date.startsWith("2026-10")).length;
    // only installment 1 paid → only the lessons of month 1 count
    expect(run("2026-09", ["pkg:e1:1:1"])).toMatchObject({ studentLessons: sep, amount: Math.round(((2_400_000 / total) * sep) / 10) });
    expect(run("2026-10", ["pkg:e1:1:1"]).studentLessons).toBe(0);
    expect(run("2026-12", ["pkg:e1:1:1"]).studentLessons).toBe(0);
    // installment 2 paid but not 1 → October still does not count
    expect(run("2026-10", ["pkg:e1:1:2"]).studentLessons).toBe(0);
    expect(run("2026-10", ["pkg:e1:1:1", "pkg:e1:1:2"]).studentLessons).toBe(oct);
    expect(run("2026-11", ["pkg:e1:1:1", "pkg:e1:1:2"]).studentLessons).toBe(0);
  });

  it("pay from collected, leaver: an installment credited to 0 does not block the lessons it covers (N2)", () => {
    // 24 lessons for 1 200 000 in 2 installments, Tue/Thu from Thu Oct 1; leaves Nov 5 after 11 lessons
    const TT = [{ weekday: 2, startTime: "14:00", endTime: "15:30" }, { weekday: 4, startTime: "14:00", endTime: "15:30" }];
    const c = { pricingType: "PACKAGE" as const, price: 1_200_000, packageLessons: 24, installments: 2 };
    const at = (asOf: string, left: boolean) =>
      scenario({ slots: TT, asOf, course: c, groupStart: "2026-10-01", enrollment: left ? { endDate: "2026-11-05", status: "LEFT" } : {} });
    const ledger = new FakeLedger();
    const entries: AllocEntry[] = [];
    const post = (date: string, added: { billingKey: string | null; type: AllocEntry["type"]; amount: number }[]) =>
      added.forEach((x) => entries.push({ id: `x${entries.length}`, type: x.type, amount: x.amount, date, enrollmentId: "e1", billingKey: x.billingKey, reversesId: null }));
    post("2026-10-01", ledger.sync(at("2026-10-01", false)));
    post("2026-11-01", ledger.sync(at("2026-11-01", false)));
    // the family pays both installments in full, then the student leaves
    entries.push({ id: "pay", type: "PAYMENT", amount: 1_200_000, date: "2026-11-02", enrollmentId: null, billingKey: null, reversesId: null });
    post("2026-11-06", ledger.sync(at("2026-11-06", true)));
    expect(computeExpected(at("2026-11-06", true)).map((u) => [u.key, u.amount])).toEqual([["pkg:e1:1:1", 550_000], ["pkg:e1:1:2", 0]]);
    const alloc = allocate(entries);
    expect(alloc.totalDebt).toBe(0);
    const paidKeys = new Set(alloc.units.filter((u) => u.due === 0 && u.charged > 0).map((u) => u.key));
    expect(paidKeys).toEqual(new Set(["pkg:e1:1:1"]));

    let input = at("2026-11-30", true);
    for (const l of input.lessons) if (l.date <= "2026-11-05") input = withStatus(input, l.date, "HELD");
    const lessons: LessonRow[] = input.lessons.map((l) => ({ id: l.id, date: l.date, status: l.status, teacherId: "T", groupId: "g1", groupName: "PKG" }));
    const enrollmentsByGroup = new Map([["g1", [{ input, studentName: "A" }]]]);
    const held = collectLessons({ teacherId: "T", month: "2026-11", lessons, enrollmentsByGroup, payTrial: false, paidKeys });
    // November 3 and 5 count, keyed to the installment that was actually charged
    expect(held.map((l) => [l.date, l.students[0]?.paid, l.students[0]?.key])).toEqual([
      ["2026-11-03", true, "pkg:e1:1:1"],
      ["2026-11-05", true, "pkg:e1:1:1"],
    ]);
    const r = computeSalary({ rule: rule({ percent: 10 }), lessons: held, adjustments: [], payFromCollected: true });
    expect(r.lines[0]).toMatchObject({ studentLessons: 2, amount: Math.round((1_200_000 / 24) * 2 * 0.1) });
    // an open enrollment still needs installment 2 paid for its November lessons
    let open = at("2026-11-30", false);
    for (const l of open.lessons) if (l.date <= "2026-11-05") open = withStatus(open, l.date, "HELD");
    const openHeld = collectLessons({ teacherId: "T", month: "2026-11", lessons, enrollmentsByGroup: new Map([["g1", [{ input: open, studentName: "A" }]]]), payTrial: false, paidKeys });
    expect(openHeld[0].students[0].paid).toBe(false);
  });

  it("archived teacher: no fixed/base pay for months after leaving; held lessons still paid", () => {
    const { lessons, enrollmentsByGroup } = setup();
    const held = collectLessons({ teacherId: "T", month: "2026-10", lessons, enrollmentsByGroup, payTrial: false, paidKeys: new Set() });
    const fixed = rule({ model: "FIXED", fixedAmount: 3_000_000 });
    // archived in September → nothing fixed for October
    const after = computeSalary({ rule: fixed, lessons: [], adjustments: [], payFromCollected: false, month: "2026-10", archivedOn: "2026-09-20" });
    expect(after).toMatchObject({ base: 0, total: 0 });
    expect(after.warnings).toContain("archived");
    // the month they leave in is still paid in full
    expect(computeSalary({ rule: fixed, lessons: [], adjustments: [], payFromCollected: false, month: "2026-09", archivedOn: "2026-09-20" }).total).toBe(3_000_000);
    // base + %: the percent of lessons actually held stays
    const bp = computeSalary({ rule: rule({ model: "BASE_PLUS_PERCENT", fixedAmount: 1_000_000, percent: 20 }), lessons: held, adjustments: [], payFromCollected: false, month: "2026-10", archivedOn: "2026-09-30" });
    expect(bp.total).toBe(Math.round(per * 6 * 0.2));
    // archived on the 1st of the month: that month still counts
    expect(computeSalary({ rule: fixed, lessons: [], adjustments: [], payFromCollected: false, month: "2026-10", archivedOn: "2026-10-01" }).total).toBe(3_000_000);
  });

  it("bonuses and fines are added", () => {
    const r = computeSalary({ rule: rule({ model: "FIXED", fixedAmount: 2_000_000 }), lessons: [], adjustments: [{ amount: 300_000, reason: "bonus" }, { amount: -50_000, reason: "kechikish" }], payFromCollected: false });
    expect(r.total).toBe(2_250_000);
    expect(r.adjustmentsTotal).toBe(250_000);
  });

  it("no rule → zero with a warning", () => {
    const r = computeSalary({ rule: null, lessons: [], adjustments: [], payFromCollected: false });
    expect(r.total).toBe(0);
    expect(r.warnings).toContain("noRule");
  });

  it("cancelled or unmarked lessons are not paid", () => {
    const { lessons, enrollmentsByGroup } = setup();
    const changed = lessons.map((l) => (l.date === "2026-10-05" ? { ...l, status: "CANCELLED" as const } : l));
    const held = collectLessons({ teacherId: "T", month: "2026-10", lessons: changed, enrollmentsByGroup, payTrial: false, paidKeys: new Set() });
    expect(held).toHaveLength(2);
  });
});
