import { describe, expect, it } from "vitest";
import { computeExpected, lessonValue, planSync, round100 } from "./engine";
import { generateLessonDates } from "./lessons";
import { periodContaining } from "./periods";
import { FakeLedger, MWF, TTS, scenario, withStatus } from "./testkit";

// October 2026 on Mon/Wed/Fri has 13 lessons: 2 5 7 9 12 14 16 19 21 23 26 28 30.
// November 2026 on Mon/Wed/Fri has 13 lessons; on Tue/Thu/Sat it has 12.

describe("periods", () => {
  it("calendar month", () => {
    expect(periodContaining("2026-10-17", 1)).toEqual({ start: "2026-10-01", end: "2026-10-31" });
  });
  it("anchored on the 15th", () => {
    expect(periodContaining("2026-10-10", 15)).toEqual({ start: "2026-09-15", end: "2026-10-14" });
    expect(periodContaining("2026-10-15", 15)).toEqual({ start: "2026-10-15", end: "2026-11-14" });
  });
  it("anchored on the 31st clamps to month end", () => {
    expect(periodContaining("2026-02-15", 31)).toEqual({ start: "2026-01-31", end: "2026-02-27" });
    expect(periodContaining("2026-03-01", 31)).toEqual({ start: "2026-02-28", end: "2026-03-30" });
    expect(periodContaining("2026-04-10", 31)).toEqual({ start: "2026-03-31", end: "2026-04-29" });
  });
});

describe("subscription — calendar", () => {
  it("full month → exactly the price", () => {
    const input = scenario({ asOf: "2026-10-01", enrollment: { activatedAt: "2026-10-01" } });
    const units = computeExpected(input);
    expect(units).toHaveLength(1);
    expect(units[0]).toMatchObject({ key: "sub:e1:2026-10-01", amount: 600_000, period: "2026-10" });
    expect(units[0].description).toBe("Oktyabr 2026 · GE-A1 Morning (#12) · 13/13 dars");
  });

  it("joining mid-month with 5 of 13 lessons left → price × 5/13 rounded to 100", () => {
    const input = scenario({ asOf: "2026-10-20", enrollment: { startDate: "2026-10-20", activatedAt: "2026-10-20" } });
    const [u] = computeExpected(input);
    expect(u.amount).toBe(round100((600_000 * 5) / 13));
    expect(u.amount).toBe(230_800);
  });

  it("prepays only started periods, one per month", () => {
    const input = scenario({ asOf: "2026-12-05" });
    expect(computeExpected(input).map((u) => [u.period, u.amount])).toEqual([
      ["2026-10", 600_000],
      ["2026-11", 600_000],
      ["2026-12", 600_000],
    ]);
  });

  it("activation on a future lesson charges its period right away, pro-rated from that day", () => {
    const units = computeExpected(scenario({ asOf: "2026-10-12", enrollment: { startDate: "2026-10-12", activatedAt: "2026-10-14" } }));
    // 14 16 19 21 23 26 28 30 = 8 of 13
    expect(units.map((u) => [u.key, u.amount])).toEqual([["sub:e1:2026-10-01", round100((600_000 * 8) / 13)]]);
  });

  it("trial (not activated) is free", () => {
    expect(computeExpected(scenario({ asOf: "2026-10-10", enrollment: { status: "TRIAL", activatedAt: null } }))).toEqual([]);
  });

  it("center cancels a lesson after the month was charged → credit of one lesson, then nothing", () => {
    const ledger = new FakeLedger();
    const base = scenario({ asOf: "2026-10-01" });
    ledger.sync(base);
    expect(ledger.owed).toBe(600_000);

    const cancelled = withStatus({ ...base, asOf: "2026-10-09" }, "2026-10-07", "CANCELLED");
    const added = ledger.sync(cancelled);
    expect(added).toHaveLength(1);
    expect(added[0].type).toBe("CREDIT");
    expect(added[0].amount).toBe(600_000 - round100((600_000 * 12) / 13));
    expect(ledger.owed).toBe(553_800);
    expect(ledger.sync(cancelled)).toEqual([]);
  });

  it("restoring a cancelled lesson charges it back", () => {
    const ledger = new FakeLedger();
    const base = scenario({ asOf: "2026-10-09" });
    ledger.sync(withStatus(base, "2026-10-07", "CANCELLED"));
    ledger.sync(base);
    expect(ledger.owed).toBe(600_000);
  });

  it("student absent → still charged (no credit)", () => {
    const ledger = new FakeLedger();
    const input = scenario({ asOf: "2026-10-01" });
    ledger.sync(input);
    const absent = { ...withStatus(input, "2026-10-05", "HELD"), asOf: "2026-10-06" };
    expect(ledger.sync(absent)).toEqual([]);
  });

  it("excused absence: setting off → no credit; setting on → one lesson credited", () => {
    const off = new FakeLedger();
    const input = scenario({ asOf: "2026-10-06" });
    const excused = withStatus(input, "2026-10-05", "HELD");
    excused.excusedLessonIds = new Set([excused.lessons.find((l) => l.date === "2026-10-05")!.id]);
    off.sync(input);
    expect(off.sync(excused)).toEqual([]);

    const on = new FakeLedger();
    on.sync({ ...input, settings: { excusedAbsenceCredit: true } });
    const added = on.sync({ ...excused, settings: { excusedAbsenceCredit: true } });
    expect(added).toHaveLength(1);
    expect(on.owed).toBe(round100((600_000 * 12) / 13));
  });

  it("freeze of two weeks inside a month → frozen lessons credited", () => {
    const ledger = new FakeLedger();
    const input = scenario({ asOf: "2026-10-01" });
    ledger.sync(input);
    const frozen = scenario({ asOf: "2026-10-12", enrollment: { freezes: [{ from: "2026-10-12", to: "2026-10-25" }] } });
    ledger.sync(frozen);
    // 6 lessons frozen (12 14 16 19 21 23) → 7/13 paid
    expect(ledger.owed).toBe(round100((600_000 * 7) / 13));
    expect(ledger.sync(frozen)).toEqual([]);
  });

  it("freeze spanning two months credits both months", () => {
    const input = scenario({
      asOf: "2026-11-03",
      enrollment: { freezes: [{ from: "2026-10-26", to: "2026-11-08" }] },
    });
    const units = computeExpected(input);
    // Oct: 26 28 30 frozen → 10/13. Nov: 2 4 6 frozen → 10/13
    expect(units.map((u) => u.amount)).toEqual([round100((600_000 * 10) / 13), round100((600_000 * 10) / 13)]);
  });

  it("leaving mid-month credits the future lessons", () => {
    const ledger = new FakeLedger();
    ledger.sync(scenario({ asOf: "2026-10-01" }));
    ledger.sync(scenario({ asOf: "2026-10-17", enrollment: { status: "LEFT", endDate: "2026-10-16" } }));
    // 2 5 7 9 12 14 16 → 7 lessons used
    expect(ledger.owed).toBe(round100((600_000 * 7) / 13));
    // and later months are never charged
    expect(ledger.sync(scenario({ asOf: "2026-12-01", enrollment: { status: "LEFT", endDate: "2026-10-16" } }))).toEqual([]);
  });

  it("transfer on the 15th from A (600k) to B (800k), 12 lessons each, 6 before the move", () => {
    const a = new FakeLedger();
    const b = new FakeLedger();
    const startA = scenario({ slots: TTS, asOf: "2026-11-01", enrollment: { id: "eA", activatedAt: "2026-11-01", startDate: "2026-11-01" } });
    a.sync(startA);
    expect(a.owed).toBe(600_000);

    // move on 15 Nov: A closes on the 14th, B opens on the 15th (both active)
    const closedA = scenario({
      slots: TTS,
      asOf: "2026-11-15",
      enrollment: { id: "eA", activatedAt: "2026-11-01", startDate: "2026-11-01", endDate: "2026-11-14", status: "TRANSFERRED" },
    });
    const openB = scenario({
      slots: TTS,
      asOf: "2026-11-15",
      course: { price: 800_000 },
      enrollment: { id: "eB", activatedAt: "2026-11-15", startDate: "2026-11-15" },
    });
    a.sync(closedA);
    b.sync(openB);
    expect(a.owed).toBe(300_000);
    expect(b.owed).toBe(400_000);
    expect(a.sync(closedA)).toEqual([]);
    expect(b.sync(openB)).toEqual([]);
  });

  it("discount 20% until the end of next month applies to two periods, then stops", () => {
    const input = scenario({
      asOf: "2026-12-05",
      enrollment: { discountPercent: 20, discountUntil: "2026-11-30", discountReason: "aka-uka" } as never,
    });
    expect(computeExpected(input).map((u) => u.amount)).toEqual([480_000, 480_000, 600_000]);
  });

  it("fixed discount and price overrides", () => {
    const input = scenario({ asOf: "2026-10-01", groupPrice: 700_000, enrollment: { discountAmount: 50_000 } });
    expect(computeExpected(input)[0].amount).toBe(650_000);
    const own = scenario({ asOf: "2026-10-01", groupPrice: 700_000, enrollment: { priceOverride: 500_000 } });
    expect(computeExpected(own)[0].amount).toBe(500_000);
  });

  it("holidays generate no lessons and are never charged", () => {
    const planned = generateLessonDates(MWF, "2026-10-01", "2026-10-31", new Set(["2026-10-02"]));
    expect(planned.find((l) => l.date === "2026-10-02")).toBeUndefined();
    expect(planned).toHaveLength(12);
    const input = scenario({ asOf: "2026-10-02", holidays: ["2026-10-02"], enrollment: { activatedAt: "2026-10-02" } });
    expect(computeExpected(input)[0]).toMatchObject({ amount: 600_000 });
    expect(computeExpected(input)[0].description).toContain("12/12");
  });

  it("a group starting mid-month is pro-rated by the slots before its start", () => {
    const input = scenario({ asOf: "2026-10-19", groupStart: "2026-10-19", enrollment: { startDate: "2026-10-19", activatedAt: "2026-10-19" } });
    // 19 21 23 26 28 30 = 6 of 13 slot dates in October
    expect(computeExpected(input)[0].amount).toBe(round100((600_000 * 6) / 13));
  });

  it("idempotency: running sync many times equals running it once", () => {
    const ledger = new FakeLedger();
    const input = withStatus(
      scenario({ asOf: "2026-12-10", enrollment: { freezes: [{ from: "2026-11-02", to: "2026-11-10" }], discountPercent: 10 } }),
      "2026-10-14",
      "CANCELLED",
    );
    ledger.sync(input);
    const snapshot = [...ledger.entries];
    for (let i = 0; i < 5; i++) expect(ledger.sync(input)).toEqual([]);
    expect(ledger.entries).toEqual(snapshot);
  });

  it("enrollment back to trial → everything credited", () => {
    const ledger = new FakeLedger();
    ledger.sync(scenario({ asOf: "2026-11-02" }));
    ledger.sync(scenario({ asOf: "2026-11-02", enrollment: { status: "TRIAL", activatedAt: null } }));
    expect(ledger.owed).toBe(0);
  });
});

describe("price history", () => {
  it("a price change applies only to periods starting on/after its date", () => {
    const input = scenario({
      asOf: "2026-12-05",
      course: { price: 700_000, prices: [{ from: "2000-01-01", price: 600_000 }, { from: "2026-12-01", price: 700_000 }] },
    });
    expect(computeExpected(input).map((u) => u.amount)).toEqual([600_000, 600_000, 700_000]);
  });
});

describe("subscription — anchors", () => {
  it("group-start anchor (15th)", () => {
    const input = scenario({
      asOf: "2026-11-20",
      groupStart: "2026-09-15",
      course: { renewal: "GROUP_START" },
      enrollment: { activatedAt: "2026-10-15", startDate: "2026-10-15" },
    });
    const units = computeExpected(input);
    expect(units.map((u) => u.key)).toEqual(["sub:e1:2026-10-15", "sub:e1:2026-11-15"]);
    expect(units[0].amount).toBe(600_000);
    expect(units[0].description.startsWith("15.10–14.11.2026")).toBe(true);
  });

  it("group-start anchor on the 31st clamps to month end", () => {
    const input = scenario({
      asOf: "2026-04-01",
      groupStart: "2026-01-31",
      course: { renewal: "GROUP_START" },
      enrollment: { activatedAt: "2026-01-31", startDate: "2026-01-31" },
    });
    expect(computeExpected(input).map((u) => u.key)).toEqual([
      "sub:e1:2026-01-31",
      "sub:e1:2026-02-28",
      "sub:e1:2026-03-31",
    ]);
    expect(computeExpected(input).every((u) => u.amount === 600_000)).toBe(true);
  });

  it("student-start anchor follows the activation day", () => {
    const input = scenario({
      asOf: "2026-11-20",
      course: { renewal: "STUDENT_START", price: 900_000 },
      enrollment: { activatedAt: "2026-10-21", startDate: "2026-10-20" },
    });
    const units = computeExpected(input);
    expect(units.map((u) => u.key)).toEqual(["sub:e1:2026-10-21", "sub:e1:2026-11-21"].slice(0, 1));
    expect(units[0].amount).toBe(900_000);
    expect(computeExpected({ ...input, asOf: "2026-11-21" }).map((u) => u.key)).toEqual([
      "sub:e1:2026-10-21",
      "sub:e1:2026-11-21",
    ]);
  });

  it("student-start anchor on the 31st clamps", () => {
    const input = scenario({
      asOf: "2027-03-01",
      course: { renewal: "STUDENT_START" },
      enrollment: { activatedAt: "2026-12-31", startDate: "2026-12-31" },
    });
    expect(computeExpected(input).map((u) => u.start)).toEqual(["2026-12-31", "2027-01-31", "2027-02-28"]);
  });
});

describe("package", () => {
  const pkg = { pricingType: "PACKAGE" as const, price: 1_200_000, packageLessons: 12 };

  it("N=12 → charged at start", () => {
    const units = computeExpected(scenario({ asOf: "2026-10-01", course: pkg }));
    expect(units).toEqual([expect.objectContaining({ key: "pkg:e1:1", amount: 1_200_000 })]);
  });

  it("after 12 lessons are used and more are ahead → the second package is charged", () => {
    expect(computeExpected(scenario({ asOf: "2026-10-27", course: pkg })).map((u) => u.key)).toEqual(["pkg:e1:1"]);
    const units = computeExpected(scenario({ asOf: "2026-10-28", course: pkg }));
    expect(units.map((u) => [u.key, u.amount])).toEqual([
      ["pkg:e1:1", 1_200_000],
      ["pkg:e1:2", 1_200_000],
    ]);
  });

  it("leaving after 15 lessons → total = 15 × rate", () => {
    const ledger = new FakeLedger();
    ledger.sync(scenario({ asOf: "2026-10-28", course: pkg }));
    expect(ledger.owed).toBe(2_400_000);
    // lessons 13, 14, 15 = Oct 30, Nov 2, Nov 4; leaves after Nov 4
    ledger.sync(scenario({ asOf: "2026-11-10", course: pkg, enrollment: { endDate: "2026-11-04", status: "LEFT" } }));
    expect(ledger.owed).toBe(15 * 100_000);
  });

  it("whole course in 4 installments → one installment becomes due each month", () => {
    const c = { pricingType: "PACKAGE" as const, price: 2_400_000, packageLessons: null, installments: 4, durationMonths: 4 };
    const at = (asOf: string) =>
      computeExpected(scenario({ slots: TTS, asOf, course: c, groupStart: "2026-10-01", groupEnd: "2027-01-31" }));
    expect(at("2026-10-01").map((u) => [u.key, u.amount])).toEqual([["pkg:e1:1:1", 600_000]]);
    expect(at("2026-11-01").map((u) => u.amount)).toEqual([600_000, 600_000]);
    expect(at("2026-12-15").reduce((s, u) => s + u.amount, 0)).toBe(1_800_000);
    expect(at("2027-01-01").reduce((s, u) => s + u.amount, 0)).toBe(2_400_000);
    expect(at("2027-01-01").map((u) => u.description)[3]).toContain("to'lov 4/4");
  });

  it("whole course with a late joiner pays only for the lessons left", () => {
    const c = { pricingType: "PACKAGE" as const, price: 2_400_000, packageLessons: null };
    const input = scenario({
      slots: TTS,
      asOf: "2026-11-15",
      course: c,
      groupStart: "2026-10-01",
      groupEnd: "2027-01-31",
      enrollment: { activatedAt: "2026-11-15", startDate: "2026-11-15" },
    });
    const [u] = computeExpected(input);
    expect(u.amount).toBeLessThan(2_400_000);
    expect(u.amount).toBeGreaterThan(1_000_000);
  });

  it("per-lesson pricing (N=1) is prepaid one lesson ahead", () => {
    const c = { pricingType: "PACKAGE" as const, price: 150_000, packageLessons: 1 };
    const sum = (asOf: string) => computeExpected(scenario({ asOf, course: c })).reduce((s, u) => s + u.amount, 0);
    expect(sum("2026-10-01")).toBe(150_000); // first lesson prepaid
    expect(sum("2026-10-02")).toBe(300_000); // lesson 1 used → lesson 2 prepaid
    expect(sum("2026-10-05")).toBe(450_000);
    const ledger = new FakeLedger();
    ledger.sync(scenario({ asOf: "2026-10-05", course: c }));
    // leaves after 2 lessons: the prepaid third is credited
    ledger.sync(scenario({ asOf: "2026-10-08", course: c, enrollment: { endDate: "2026-10-05", status: "LEFT" } }));
    expect(ledger.owed).toBe(300_000);
  });

  it("package lessons cancelled by the center are not consumed", () => {
    const input = withStatus(scenario({ asOf: "2026-10-28", course: pkg }), "2026-10-05", "CANCELLED");
    // only 11 used by the 28th → still one package
    expect(computeExpected(input)).toHaveLength(1);
  });
});

describe("planSync", () => {
  it("posts nothing when ledger matches", () => {
    const units = [{ key: "k", enrollmentId: "e", amount: 100, start: "2026-10-01", due: "2026-10-01", period: null, description: "x" }];
    expect(planSync(units, [{ billingKey: "k", type: "CHARGE", amount: -100 }])).toEqual([]);
  });
  it("ignores payments", () => {
    expect(planSync([], [{ billingKey: null, type: "PAYMENT", amount: 500 }])).toEqual([]);
  });
});

describe("lessonValue (teacher % base)", () => {
  it("subscription: price / scheduled lessons of the period", () => {
    const input = scenario({ asOf: "2026-10-31" });
    const id = input.lessons.find((l) => l.date === "2026-10-05")!.id;
    expect(lessonValue(input, id, false)?.value).toBeCloseTo(600_000 / 13);
  });
  it("trial students count only when the toggle is on", () => {
    const input = scenario({ asOf: "2026-10-31", enrollment: { status: "TRIAL", activatedAt: null } });
    const id = input.lessons.find((l) => l.date === "2026-10-05")!.id;
    expect(lessonValue(input, id, false)).toBeNull();
    expect(lessonValue(input, id, true)?.value).toBeCloseTo(600_000 / 13);
  });
  it("package: price / N", () => {
    const input = scenario({ asOf: "2026-10-31", course: { pricingType: "PACKAGE", price: 1_200_000, packageLessons: 12 } });
    const id = input.lessons.find((l) => l.date === "2026-10-30")!.id;
    expect(lessonValue(input, id, false)).toMatchObject({ value: 100_000, key: "pkg:e1:2" });
  });
});

describe("review fixes", () => {
  it("a price override set from October does not re-price August and September", () => {
    const input = scenario({
      asOf: "2026-10-05",
      enrollment: {
        activatedAt: "2026-08-01",
        startDate: "2026-08-01",
        priceOverride: 500_000,
        terms: [
          { from: "2000-01-01", priceOverride: null, discountPercent: null, discountAmount: null, discountUntil: null },
          { from: "2026-10-01", priceOverride: 500_000, discountPercent: null, discountAmount: null, discountUntil: null },
        ],
      },
      groupStart: "2026-08-01",
    });
    expect(computeExpected(input).map((u) => u.amount)).toEqual([600_000, 600_000, 500_000]);
  });

  it("a 100% discount from this month leaves earlier months owed", () => {
    const input = scenario({
      asOf: "2026-10-05",
      groupStart: "2026-09-01",
      enrollment: {
        activatedAt: "2026-09-01",
        startDate: "2026-09-01",
        discountPercent: 100,
        terms: [
          { from: "2000-01-01", priceOverride: null, discountPercent: null, discountAmount: null, discountUntil: null },
          { from: "2026-10-01", priceOverride: null, discountPercent: 100, discountAmount: null, discountUntil: null },
        ],
      },
    });
    expect(computeExpected(input).map((u) => u.amount)).toEqual([600_000, 0]);
  });

  it("group price override history applies from its date", () => {
    const input = scenario({ asOf: "2026-11-05", groupPrice: 700_000 });
    input.group.prices = [{ from: "2000-01-01", price: null }, { from: "2026-11-01", price: 700_000 }];
    expect(computeExpected(input).map((u) => u.amount)).toEqual([600_000, 700_000]);
  });

  it("percent and fixed discounts never stack (percent wins)", () => {
    expect(computeExpected(scenario({ asOf: "2026-10-01", enrollment: { discountPercent: 10, discountAmount: 50_000 } }))[0].amount).toBe(540_000);
  });

  it("an activation date before the start date never charges lessons before the student joined", () => {
    const input = scenario({ asOf: "2026-10-20", enrollment: { startDate: "2026-10-20", activatedAt: "2026-10-01" } });
    expect(computeExpected(input)[0].amount).toBe(round100((600_000 * 5) / 13));
  });

  it("whole course stays one package when the schedule shrinks", () => {
    const c = { pricingType: "PACKAGE" as const, price: 2_400_000, packageLessons: null };
    const base = scenario({ slots: MWF, asOf: "2026-12-20", course: c, groupStart: "2026-10-01", groupEnd: "2027-01-31", lessonsTo: "2026-11-30" });
    // after November only Mon/Wed lessons were generated
    const extra = generateLessonDates(MWF.filter((s) => s.weekday !== 5), "2026-12-01", "2026-12-31", new Set()).map((l) => ({ id: `x${l.date}`, date: l.date, status: "SCHEDULED" as const }));
    const input = { ...base, lessons: [...base.lessons, ...extra], group: { ...base.group, slotWeekdays: [1, 3] } };
    const units = computeExpected(input);
    expect(units).toHaveLength(1);
    expect(units[0].amount).toBe(2_400_000);
  });

  it("whole course without an end date is never charged twice", () => {
    const c = { pricingType: "PACKAGE" as const, price: 2_400_000, packageLessons: null, durationMonths: 1 };
    const units = computeExpected(scenario({ asOf: "2027-02-01", course: c, groupStart: "2026-10-01" }));
    expect(units).toHaveLength(1);
    expect(units[0].amount).toBe(2_400_000);
  });

  it("a package student leaving today is closed today", () => {
    const pkg = { pricingType: "PACKAGE" as const, price: 1_200_000, packageLessons: 12 };
    const units = computeExpected(scenario({ asOf: "2026-10-28", course: pkg, enrollment: { endDate: "2026-10-28", status: "LEFT" } }));
    expect(units.reduce((s, u) => s + u.amount, 0)).toBe(1_200_000);
  });
});
