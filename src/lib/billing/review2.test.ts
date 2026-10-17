// Regression tests for the second money review (2026-10-17): N3 horizon, N4 denominator.
import { describe, expect, it } from "vitest";
import type { ISODate } from "@/lib/dates";
import { computeExpected, round100 } from "./engine";
import { FakeLedger, scenario } from "./testkit";
import type { BillingInput, BillingLesson } from "./types";

/** Reschedule the lesson on `from` to `to` (Lesson.origDate keeps the slot it came from). */
function moved(input: BillingInput, from: ISODate, to: ISODate): BillingInput {
  return { ...input, lessons: input.lessons.map((l) => (l.date === from ? { ...l, date: to, origDate: from } : l)) };
}

function withLesson(input: BillingInput, l: BillingLesson): BillingInput {
  return { ...input, lessons: [...input.lessons, l].sort((a, b) => a.date.localeCompare(b.date)) };
}

describe("N3 — a lesson moved far ahead does not push the generation horizon", () => {
  // December 2026 Mon/Wed/Fri: 13 lessons, 9 from the 10th; lessons generated up to Dec 16, then Dec 16 moved to Dec 19
  const base = { groupStart: "2026-09-01", enrollment: { startDate: "2026-12-10", activatedAt: "2026-12-10" } };
  const at = (asOf: string, lessonsTo: string) => moved(scenario({ ...base, asOf, lessonsTo }), "2026-12-16", "2026-12-19");

  it("the first sync posts the final 9/13", () => {
    const [u] = computeExpected(at("2026-10-17", "2026-12-16"));
    expect(u.amount).toBe(round100((600_000 * 9) / 13));
    expect(u.description).toContain("9/13 dars");
  });

  it("later syncs post nothing as the rest of December gets generated", () => {
    const ledger = new FakeLedger();
    expect(ledger.sync(at("2026-10-17", "2026-12-16"))).toEqual([{ billingKey: "sub:e1:2026-12-01", type: "CHARGE", amount: -415_400 }]);
    for (const [asOf, to] of [["2026-10-18", "2026-12-17"], ["2026-10-20", "2026-12-19"], ["2026-11-01", "2026-12-31"], ["2026-12-31", "2027-03-01"]]) {
      expect(ledger.sync(at(asOf, to)), asOf).toEqual([]);
    }
    expect(ledger.owed).toBe(415_400);
  });

  it("a moved-ahead whole-course package still counts the slot dates not generated yet", () => {
    const c = { pricingType: "PACKAGE" as const, price: 2_600_000, packageLessons: null };
    const input = (to: string) => moved(scenario({ asOf: "2026-10-17", course: c, groupStart: "2026-12-01", groupEnd: "2026-12-31", lessonsTo: to, enrollment: { startDate: "2026-12-01", activatedAt: "2026-12-01" } }), "2026-12-16", "2026-12-19");
    // 13 December lessons whatever the generation horizon: 2 600 000 / 13 per lesson
    expect(computeExpected(input("2026-12-16"))[0].description).toContain("13 dars");
    expect(computeExpected(input("2026-12-31"))[0].description).toContain("13 dars");
  });
});

describe("N4 — lessons kept after the group's end date are not counted twice", () => {
  // October 2026 Mon/Wed/Fri: 13 slot dates; the group ends Oct 25 → 10 lessons (2 … 23)
  const ended = (asOf = "2026-10-01") => scenario({ asOf, groupStart: "2026-09-01", groupEnd: "2026-10-25" });

  it("a cancelled Oct 28 lesson kept: 10/13 = 461 500, not 10/14", () => {
    const input = withLesson(ended(), { id: "x28", date: "2026-10-28", status: "CANCELLED" });
    const [oct] = computeExpected(input);
    expect(oct.amount).toBe(461_500);
    expect(oct.description).toContain("10/13 dars");
    // same as without the kept lesson
    expect(computeExpected(ended())[0].amount).toBe(461_500);
  });

  it("a held lesson kept after the end (attendance marked) counts once, in both counts", () => {
    const input = withLesson(ended("2026-10-31"), { id: "h28", date: "2026-10-28", status: "HELD" });
    expect(computeExpected(input)[0].description).toContain("11/13 dars");
  });

  it("a lesson moved past the end from inside the window keeps the after-end slot dates", () => {
    // Oct 23 moved to Tue Oct 27: still 10 lessons over 13 slot dates
    const [oct] = computeExpected(moved(ended(), "2026-10-23", "2026-10-27"));
    expect(oct.description).toContain("10/13 dars");
    // an after-end slot lesson moved to a non-slot day stands for its slot (Oct 28 → Oct 29)
    const kept = moved(withLesson(ended(), { id: "x28", date: "2026-10-28", status: "CANCELLED" }), "2026-10-28", "2026-10-29");
    expect(computeExpected(kept)[0].description).toContain("10/13 dars");
  });

  it("a lesson kept before a moved-later start date is not counted twice either", () => {
    // group start moved to Oct 12 with the cancelled Oct 5 lesson kept: Oct 12 … 30 = 9 lessons of 13
    const input = withLesson(scenario({ asOf: "2026-10-12", groupStart: "2026-10-12", enrollment: { startDate: "2026-10-12", activatedAt: "2026-10-12" } }), { id: "x05", date: "2026-10-05", status: "CANCELLED" });
    expect(computeExpected(input)[0].description).toContain("9/13 dars");
  });
});
