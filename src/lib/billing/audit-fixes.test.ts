// Regression tests for the money findings of docs/AUDIT-2026-10-17.md (B3, B4, B8) and the
// billing edge cases the audit listed as untested.
import { describe, expect, it } from "vitest";
import { computeExpected, deltaDate, planSync, round100, wholeCourseExhausted } from "./engine";
import { transferTerms } from "./terms";
import { FakeLedger, TTS, scenario } from "./testkit";

// October 2026 on Mon/Wed/Fri: 2 5 7 9 12 14 16 19 21 23 26 28 30 = 13 lessons.
// December 2026 on Mon/Wed/Fri: 2 4 7 9 11 14 16 18 21 23 25 28 30 = 13 lessons; from the 10th: 9.

describe("edge cases the audit listed as untested", () => {
  it("group-start anchor (15th): joining mid-period pays the lessons left, the next period in full", () => {
    // period 15.10–14.11: Oct 16 19 21 23 26 28 30, Nov 2 4 6 9 11 13 = 13; from Oct 26: 9
    const input = (asOf: string) =>
      scenario({ asOf, groupStart: "2026-09-15", course: { renewal: "GROUP_START" }, enrollment: { startDate: "2026-10-26", activatedAt: "2026-10-26" } });
    const ledger = new FakeLedger();
    expect(ledger.sync(input("2026-10-26"))).toEqual([{ billingKey: "sub:e1:2026-10-15", type: "CHARGE", amount: -415_400 }]);
    expect(computeExpected(input("2026-10-26"))[0].description).toBe("15.10–14.11.2026 · GE-A1 Morning (#12) · 9/13 dars");
    expect(ledger.sync(input("2026-11-14"))).toEqual([]);
    expect(ledger.sync(input("2026-11-15"))).toEqual([{ billingKey: "sub:e1:2026-11-15", type: "CHARGE", amount: -600_000 }]);
  });

  it("installments + rollover: the next package's first installment comes with the 12th lesson", () => {
    const c = { pricingType: "PACKAGE" as const, price: 1_200_000, packageLessons: 12, installments: 2 };
    const at = (asOf: string) => computeExpected(scenario({ asOf, course: c })).map((u) => [u.key, u.amount]);
    expect(at("2026-10-27")).toEqual([["pkg:e1:1:1", 600_000]]);
    // the 12th lesson is Oct 28: package 2 starts that day, its installment 1 is due at once
    expect(at("2026-10-28")).toEqual([["pkg:e1:1:1", 600_000], ["pkg:e1:2:1", 600_000]]);
    // package 1's second installment a month after its start
    expect(at("2026-11-01")).toEqual([["pkg:e1:1:1", 600_000], ["pkg:e1:1:2", 600_000], ["pkg:e1:2:1", 600_000]]);
  });

  it("installments + leave: only the lessons used are owed, credited from the last installments", () => {
    const c = { pricingType: "PACKAGE" as const, price: 1_200_000, packageLessons: 12, installments: 2 };
    // leaves after 5 lessons, before installment 2 was due
    const early = new FakeLedger();
    early.sync(scenario({ asOf: "2026-10-01", course: c }));
    early.sync(scenario({ asOf: "2026-10-20", course: c, enrollment: { endDate: "2026-10-12", status: "LEFT" } }));
    expect(early.owed).toBe(500_000);
    expect(early.owedFor("pkg:e1:1:1")).toBe(500_000);
    expect(Math.abs(early.owedFor("pkg:e1:1:2"))).toBe(0); // never charged
    // with package 2 started: 15 lessons used → 15 × 100 000
    const late = new FakeLedger();
    late.sync(scenario({ asOf: "2026-11-02", course: c }));
    expect(late.owed).toBe(1_800_000);
    late.sync(scenario({ asOf: "2026-11-10", course: c, enrollment: { endDate: "2026-11-04", status: "LEFT" } }));
    expect(late.owed).toBe(1_500_000);
    expect(late.owedFor("pkg:e1:2:")).toBe(300_000);
  });

  it("transfer of a package course: the old group keeps only the lessons used, the new one is prepaid", () => {
    const c = { pricingType: "PACKAGE" as const, price: 1_200_000, packageLessons: 12 };
    const old = new FakeLedger();
    old.sync(scenario({ asOf: "2026-10-01", course: c }));
    // moved on Oct 19: Oct 2 5 7 9 12 14 16 used in A
    old.sync(scenario({ asOf: "2026-10-19", course: c, enrollment: { endDate: "2026-10-18", status: "TRANSFERRED" } }));
    expect(old.owed).toBe(700_000);
    const next = new FakeLedger();
    next.sync(scenario({ slots: TTS, asOf: "2026-10-19", course: { ...c, price: 1_440_000 }, enrollment: { id: "e2", startDate: "2026-10-19", activatedAt: "2026-10-19" } }));
    expect(next.entries).toEqual([{ billingKey: "pkg:e2:1", type: "CHARGE", amount: -1_440_000 }]);
  });

  it("freeze + leave in the same period: both are credited, once each", () => {
    const ledger = new FakeLedger();
    ledger.sync(scenario({ asOf: "2026-10-01" }));
    const freezes = [{ from: "2026-10-12", to: "2026-10-16" }]; // 12 14 16
    ledger.sync(scenario({ asOf: "2026-10-10", enrollment: { freezes } }));
    expect(ledger.owed).toBe(round100((600_000 * 10) / 13));
    // leaves after Oct 23: 26 28 30 credited too → 7 of 13
    ledger.sync(scenario({ asOf: "2026-10-24", enrollment: { freezes, endDate: "2026-10-23", status: "LEFT" } }));
    expect(ledger.owed).toBe(323_100);
    expect(ledger.owed).toBe(round100((600_000 * 7) / 13));
    expect(ledger.sync(scenario({ asOf: "2026-11-02", enrollment: { freezes, endDate: "2026-10-23", status: "LEFT" } }))).toEqual([]);
  });
});

describe("B3 — enrollment activated months ahead", () => {
  const base = { asOf: "2026-10-17", groupStart: "2026-09-01", enrollment: { startDate: "2026-12-10", activatedAt: "2026-12-10" } };

  it("the first sync posts the final amount (9/13) although lessons exist only 60 days ahead", () => {
    const input = scenario({ ...base, lessonsTo: "2026-12-16" });
    const [u] = computeExpected(input);
    expect(u).toMatchObject({ key: "sub:e1:2026-12-01", amount: 415_400, due: "2026-12-10" });
    expect(u.amount).toBe(round100((600_000 * 9) / 13));
    expect(u.description).toContain("9/13 dars");
  });

  it("later syncs post nothing as the lessons get generated", () => {
    const ledger = new FakeLedger();
    expect(ledger.sync(scenario({ ...base, lessonsTo: "2026-12-16" }))).toEqual([{ billingKey: "sub:e1:2026-12-01", type: "CHARGE", amount: -415_400 }]);
    const steps: [string, string][] = [
      ["2026-10-18", "2026-12-17"],
      ["2026-10-25", "2026-12-24"],
      ["2026-11-01", "2026-12-31"],
      ["2026-11-20", "2027-01-19"],
      ["2026-12-01", "2027-01-30"],
      ["2026-12-10", "2027-02-08"],
      ["2026-12-31", "2027-03-01"],
    ];
    for (const [asOf, lessonsTo] of steps) expect(ledger.sync(scenario({ ...base, asOf, lessonsTo }))).toEqual([]);
    expect(ledger.owed).toBe(415_400);
  });

  it("not-generated slot dates skip holidays in both counts", () => {
    const [u] = computeExpected(scenario({ ...base, lessonsTo: "2026-12-16", holidays: ["2026-12-25"] }));
    // 12 lessons in December, 8 of them from the 10th
    expect(u.description).toContain("8/12 dars");
    expect(u.amount).toBe(400_000);
  });

  it("a freeze over not-generated dates is respected", () => {
    const [u] = computeExpected(scenario({ ...base, lessonsTo: "2026-12-16", enrollment: { ...base.enrollment, freezes: [{ from: "2026-12-21", to: "2026-12-25" }] } }));
    expect(u.description).toContain("6/13 dars");
  });

  it("the charge is dated on the activation day, so days overdue start when the money is due", () => {
    const deltas = planSync(computeExpected(scenario({ ...base, lessonsTo: "2026-12-16" })), []);
    expect(deltas).toHaveLength(1);
    expect(deltaDate(deltas[0], "2026-10-17")).toBe("2026-12-10");
    // an ordinary period is dated on the day it is synced
    const now = planSync(computeExpected(scenario({ asOf: "2026-10-01" })), []);
    expect(deltaDate(now[0], "2026-10-01")).toBe("2026-10-01");
    // a unit that disappeared is credited today
    expect(deltaDate({ due: null }, "2026-10-17")).toBe("2026-10-17");
  });

  it("a group that stopped generating lessons (finished, no end date) is not priced on slot dates", () => {
    const input = scenario({ asOf: "2026-10-17", groupStart: "2026-08-01", lessonsTo: "2026-08-15", enrollment: { startDate: "2026-09-01", activatedAt: "2026-09-01" } });
    const stopped = { ...input, group: { ...input.group, generating: false } };
    expect(computeExpected(stopped).map((u) => u.amount)).toEqual([0, 0]);
    // past days without a lesson are never counted, even for an active group
    expect(computeExpected(input)[0].amount).toBe(0);
  });

  it("a group starting months ahead with no lessons generated yet charges the final amount", () => {
    const ledger = new FakeLedger();
    const at = (asOf: string, lessonsTo: string) =>
      scenario({ asOf, groupStart: "2027-01-11", lessonsTo, enrollment: { startDate: "2027-01-11", activatedAt: "2027-01-11" } });
    // January 2027 MWF: 1 4 6 8 11 13 15 18 20 22 25 27 29 = 13; the group starts on the 11th → 9/13
    const first = ledger.sync(at("2026-10-17", "2026-12-16"));
    expect(first).toEqual([{ billingKey: "sub:e1:2027-01-01", type: "CHARGE", amount: -round100((600_000 * 9) / 13) }]);
    expect(ledger.sync(at("2026-11-20", "2027-01-19"))).toEqual([]);
    expect(ledger.sync(at("2026-12-31", "2027-03-01"))).toEqual([]);
  });
});

describe("B8 — open-ended whole-course package, estimate used up", () => {
  // 1 month × 3 lessons/week × 4.33 → 13 lessons; September 2026 MWF has exactly 13
  const c = { pricingType: "PACKAGE" as const, price: 2_400_000, packageLessons: null, durationMonths: 1 };
  const join = (on: string) => scenario({ asOf: on, course: c, groupStart: "2026-09-01", enrollment: { startDate: on, activatedAt: on } });

  it("a late joiner after the estimate is exhausted is flagged (nothing left to sell)", () => {
    expect(wholeCourseExhausted(join("2026-10-01"))).toBe(true);
    expect(wholeCourseExhausted(join("2026-11-15"))).toBe(true);
  });

  it("a late joiner with lessons left pays their share, and is not flagged", () => {
    // 11 of 13 held before the 28th → 2 left
    const input = join("2026-09-28");
    expect(wholeCourseExhausted(input)).toBe(false);
    expect(computeExpected(input)[0].amount).toBe(Math.round((2_400_000 * 2) / 13));
  });

  it("never flags a group with an end date, a fixed-size package, a trial or a joiner from day one", () => {
    expect(wholeCourseExhausted(scenario({ asOf: "2026-10-01", course: c, groupStart: "2026-09-01", groupEnd: "2026-12-31", enrollment: { startDate: "2026-10-01", activatedAt: "2026-10-01" } }))).toBe(false);
    expect(wholeCourseExhausted(scenario({ asOf: "2026-10-01", course: { ...c, packageLessons: 12 }, groupStart: "2026-09-01", enrollment: { startDate: "2026-10-01", activatedAt: "2026-10-01" } }))).toBe(false);
    expect(wholeCourseExhausted(scenario({ asOf: "2026-10-01", course: c, groupStart: "2026-09-01", enrollment: { status: "TRIAL", startDate: "2026-10-01", activatedAt: null } }))).toBe(false);
    expect(wholeCourseExhausted(scenario({ asOf: "2026-10-01", course: c, groupStart: "2026-09-01", enrollment: { startDate: "2026-09-01", activatedAt: "2026-09-01" } }))).toBe(false);
  });
});

describe("B4 — transfer keeps the dates of scheduled terms", () => {
  // A: 50% discount scheduled from Nov 1 (setEnrollmentTerms wrote it into the current fields too).
  const history = [
    { from: "2000-01-01", priceOverride: 550_000, discountPercent: null, discountAmount: null, discountUntil: null },
    { from: "2026-11-01", priceOverride: 550_000, discountPercent: 50, discountAmount: null, discountUntil: null },
  ];
  const current = { priceOverride: 550_000, discountPercent: 50, discountAmount: null, discountUntil: null };
  // B: 800 000 on Tue/Thu/Sat; October has 14 lessons, 6 of them from the 20th
  const groupB = (asOf: string, terms: ReturnType<typeof transferTerms>) =>
    scenario({ slots: TTS, asOf, course: { price: 800_000 }, enrollment: { startDate: "2026-10-20", activatedAt: "2026-10-20", ...terms.current, terms: terms.history } });

  it("October in group B is charged without the discount that starts in November", () => {
    const moved = transferTerms(history, current);
    expect(moved.current.priceOverride).toBeNull();
    expect(moved.history.every((h) => h.priceOverride === null)).toBe(true);
    const [oct] = computeExpected(groupB("2026-10-20", moved));
    expect(oct.amount).toBe(342_900);
    expect(oct.amount).toBe(round100((800_000 * 6) / 14));
    const units = computeExpected(groupB("2026-11-01", moved));
    expect(units.map((u) => u.amount)).toEqual([342_900, 400_000]);
  });

  it("a discount ending on a date keeps that end in the new group", () => {
    const h = [{ from: "2000-01-01", priceOverride: null, discountPercent: 20, discountAmount: null, discountUntil: "2026-10-31" }];
    const moved = transferTerms(h, { priceOverride: null, discountPercent: 20, discountAmount: null, discountUntil: "2026-10-31" });
    const units = computeExpected(groupB("2026-11-01", moved));
    expect(units.map((u) => u.amount)).toEqual([round100((640_000 * 6) / 14), 800_000]);
  });

  it("without history only the current discount moves (old behaviour kept)", () => {
    const moved = transferTerms([], { priceOverride: 550_000, discountPercent: 10, discountAmount: null, discountUntil: null });
    expect(moved.history).toEqual([]);
    expect(computeExpected(groupB("2026-10-20", moved))[0].amount).toBe(round100((720_000 * 6) / 14));
  });
});
