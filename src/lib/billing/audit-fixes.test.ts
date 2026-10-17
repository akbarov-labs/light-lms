// Regression tests for the money findings of docs/AUDIT-2026-10-17.md (B3, B4, B8) and the
// billing edge cases the audit listed as untested.
import { describe, expect, it } from "vitest";
import { computeExpected, deltaDate, planSync, round100 } from "./engine";
import { transferTerms } from "./terms";
import { FakeLedger, TTS, scenario } from "./testkit";

// December 2026 on Mon/Wed/Fri: 2 4 7 9 11 14 16 18 21 23 25 28 30 = 13 lessons; from the 10th: 9.

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
