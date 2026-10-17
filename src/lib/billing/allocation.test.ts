import { describe, expect, it } from "vitest";
import { agingBuckets, allocate, debtSummary, type AllocEntry } from "./allocation";

let n = 0;
const e = (over: Partial<AllocEntry> & Pick<AllocEntry, "type" | "amount" | "date">): AllocEntry => ({
  id: `x${++n}`,
  enrollmentId: null,
  billingKey: null,
  reversesId: null,
  ...over,
});

describe("allocation", () => {
  it("sibling family: one undirected payment covers the oldest charges first", () => {
    const entries = [
      e({ type: "CHARGE", amount: -600_000, date: "2026-09-01", enrollmentId: "ali", billingKey: "sub:ali:2026-09-01" }),
      e({ type: "CHARGE", amount: -500_000, date: "2026-09-05", enrollmentId: "vali", billingKey: "sub:vali:2026-09-05" }),
      e({ type: "CHARGE", amount: -600_000, date: "2026-10-01", enrollmentId: "ali", billingKey: "sub:ali:2026-10-01" }),
      e({ type: "PAYMENT", amount: 1_000_000, date: "2026-10-03" }),
    ];
    const a = allocate(entries);
    expect(a.balance).toBe(-700_000);
    expect(a.units.map((u) => [u.key, u.due])).toEqual([
      ["sub:ali:2026-09-01", 0],
      ["sub:vali:2026-09-05", 100_000],
      ["sub:ali:2026-10-01", 600_000],
    ]);
    expect(a.enrollments.get("ali")).toMatchObject({ charged: 1_200_000, paid: 600_000, debt: 600_000 });
    expect(a.enrollments.get("vali")).toMatchObject({ debt: 100_000 });
    expect(a.oldestUnpaidDate).toBe("2026-09-05");
    expect(a.totalDebt).toBe(700_000);
  });

  it("a directed payment covers its own enrollment first", () => {
    const entries = [
      e({ type: "CHARGE", amount: -600_000, date: "2026-09-01", enrollmentId: "ali", billingKey: "a1" }),
      e({ type: "CHARGE", amount: -500_000, date: "2026-10-01", enrollmentId: "vali", billingKey: "v1" }),
      e({ type: "PAYMENT", amount: 500_000, date: "2026-10-02", enrollmentId: "vali" }),
    ];
    const a = allocate(entries);
    expect(a.enrollments.get("vali")?.debt).toBe(0);
    expect(a.enrollments.get("ali")?.debt).toBe(600_000);
  });

  it("directed leftovers spill to the family's oldest debt", () => {
    const entries = [
      e({ type: "CHARGE", amount: -600_000, date: "2026-09-01", enrollmentId: "ali", billingKey: "a1" }),
      e({ type: "CHARGE", amount: -500_000, date: "2026-10-01", enrollmentId: "vali", billingKey: "v1" }),
      e({ type: "PAYMENT", amount: 700_000, date: "2026-10-02", enrollmentId: "vali" }),
    ];
    const a = allocate(entries);
    expect(a.enrollments.get("vali")?.debt).toBe(0);
    expect(a.enrollments.get("ali")?.debt).toBe(400_000);
  });

  it("credits reduce their unit; a reversed payment brings the debt back", () => {
    const pay = e({ type: "PAYMENT", amount: 600_000, date: "2026-10-02" });
    const entries = [
      e({ type: "CHARGE", amount: -600_000, date: "2026-10-01", enrollmentId: "ali", billingKey: "a1" }),
      e({ type: "CREDIT", amount: 46_200, date: "2026-10-08", enrollmentId: "ali", billingKey: "a1" }),
      pay,
    ];
    const a = allocate(entries);
    expect(a.units[0]).toMatchObject({ charged: 553_800, due: 0 });
    expect(a.unallocated).toBe(46_200);
    expect(a.balance).toBe(46_200);
    const b = allocate([...entries, e({ type: "REVERSAL", amount: -600_000, date: "2026-10-09", reversesId: pay.id })]);
    expect(b.totalDebt).toBe(553_800);
    expect(b.balance).toBe(-553_800);
  });

  it("refunds take money back out of the wallet", () => {
    const entries = [
      e({ type: "PAYMENT", amount: 1_000_000, date: "2026-10-01" }),
      e({ type: "CHARGE", amount: -600_000, date: "2026-10-01", enrollmentId: "ali", billingKey: "a1" }),
      e({ type: "REFUND", amount: -400_000, date: "2026-10-05" }),
    ];
    const a = allocate(entries);
    expect(a.balance).toBe(0);
    expect(a.totalDebt).toBe(0);
    expect(a.unallocated).toBe(0);
  });
});

describe("debt summary for the balance cache", () => {
  it("adds up unpaid units by the day they became due, oldest first", () => {
    const a = allocate([
      e({ type: "CHARGE", amount: -600_000, date: "2026-09-01", enrollmentId: "ali", billingKey: "sub:ali:2026-09-01" }),
      e({ type: "CHARGE", amount: -500_000, date: "2026-09-01", enrollmentId: "vali", billingKey: "sub:vali:2026-09-01" }),
      e({ type: "CHARGE", amount: -600_000, date: "2026-10-01", enrollmentId: "ali", billingKey: "sub:ali:2026-10-01" }),
      e({ type: "PAYMENT", amount: 700_000, date: "2026-10-03" }),
    ]);
    expect(debtSummary(a)).toEqual({
      balance: -1_000_000,
      totalDebt: 1_000_000,
      oldestUnpaidDate: "2026-09-01",
      dues: [
        { date: "2026-09-01", amount: 400_000 },
        { date: "2026-10-01", amount: 600_000 },
      ],
    });
  });

  it("a paid-up or prepaid family has no dues", () => {
    expect(debtSummary(allocate([e({ type: "PAYMENT", amount: 100_000, date: "2026-10-01" })]))).toEqual({ balance: 100_000, totalDebt: 0, oldestUnpaidDate: null, dues: [] });
    expect(debtSummary(allocate([]))).toEqual({ balance: 0, totalDebt: 0, oldestUnpaidDate: null, dues: [] });
  });

  it("ages dues: 0–30 days, 31–60, over 60; a future due date is current", () => {
    const dues = [
      { date: "2026-07-01", amount: 1 },
      { date: "2026-08-17", amount: 10 },
      { date: "2026-08-18", amount: 100 },
      { date: "2026-09-17", amount: 1_000 },
      { date: "2026-10-17", amount: 10_000 },
      { date: "2026-11-01", amount: 100_000 },
    ];
    // 2026-08-17 is 61 days before 2026-10-17, 2026-08-18 is 60, 2026-09-17 is 30
    expect(agingBuckets(dues, "2026-10-17")).toEqual([111_000, 100, 11]);
    expect(agingBuckets([], "2026-10-17")).toEqual([0, 0, 0]);
  });
});
