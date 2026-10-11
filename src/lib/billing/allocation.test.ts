import { describe, expect, it } from "vitest";
import { allocate, type AllocEntry } from "./allocation";

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
