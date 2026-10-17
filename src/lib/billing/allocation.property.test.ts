// B7: refunds above the credit must never vanish from the per-unit debt.
// Seeded-random property test over many ledgers + the audit's concrete scenarios.
import { describe, expect, it } from "vitest";
import { addDays } from "@/lib/dates";
import { allocate, OVERDRAW_KEY, type AllocEntry } from "./allocation";

/** Small deterministic PRNG (mulberry32) so a failure is reproducible from its seed. */
function rng(seed: number) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const UNITS = [
  { key: "sub:a:2026-09-01", enrollmentId: "a" },
  { key: "sub:a:2026-10-01", enrollmentId: "a" },
  { key: "sub:b:2026-10-01", enrollmentId: "b" },
  { key: "pkg:b:1:1", enrollmentId: "b" },
  { key: null, enrollmentId: null }, // opening balance (no billing key)
];

function randomLedger(seed: number): AllocEntry[] {
  const r = rng(seed);
  const pick = <T,>(xs: T[]): T => xs[Math.floor(r() * xs.length)];
  const money = () => Math.round(1 + r() * 12) * 50_000;
  const out: AllocEntry[] = [];
  const n = 1 + Math.floor(r() * 25);
  for (let i = 0; i < n; i++) {
    const date = addDays("2026-09-01", Math.floor(r() * 120));
    const id = `s${seed}e${i}`;
    const roll = r();
    if (roll < 0.35) {
      const u = pick(UNITS);
      out.push({ id, type: "CHARGE", amount: -money(), date, enrollmentId: u.enrollmentId, billingKey: u.key, reversesId: null });
    } else if (roll < 0.45) {
      const u = pick(UNITS);
      // keyed credit (engine recalculation, may over-credit) or a keyless one
      out.push({ id, type: "CREDIT", amount: money(), date, enrollmentId: u.enrollmentId, billingKey: u.key, reversesId: null });
    } else if (roll < 0.75) {
      out.push({ id, type: "PAYMENT", amount: money(), date, enrollmentId: pick(["a", "b", null, null]), billingKey: null, reversesId: null });
    } else if (roll < 0.9) {
      out.push({ id, type: "REFUND", amount: -money(), date, enrollmentId: null, billingKey: null, reversesId: null });
    } else {
      const reversible = out.filter((x) => (x.type === "PAYMENT" || x.type === "REFUND") && !out.some((y) => y.reversesId === x.id));
      if (reversible.length === 0) continue;
      const orig = pick(reversible);
      out.push({ id, type: "REVERSAL", amount: -orig.amount, date: orig.date > date ? orig.date : date, enrollmentId: orig.enrollmentId, billingKey: null, reversesId: orig.id });
    }
  }
  // the app reads a family's ledger ordered by date
  return out.sort((x, y) => x.date.localeCompare(y.date));
}

describe("allocation invariant (seeded random ledgers)", () => {
  it("unallocated − totalDebt = balance, and debt and prepayment are never both positive", () => {
    let overdrawn = 0;
    for (let seed = 1; seed <= 20_000; seed++) {
      const entries = randomLedger(seed);
      const a = allocate(entries);
      const sum = entries.reduce((s, e) => s + e.amount, 0);
      const ctx = `seed ${seed}`;
      expect(a.balance, ctx).toBe(sum);
      expect(a.unallocated - a.totalDebt, ctx).toBe(a.balance);
      if (a.balance < 0) {
        expect(a.totalDebt, ctx).toBe(-a.balance);
        expect(a.unallocated, ctx).toBe(0);
        expect(a.oldestUnpaidDate, ctx).not.toBeNull();
      } else {
        expect(a.totalDebt, ctx).toBe(0);
        expect(a.unallocated, ctx).toBe(a.balance);
        expect(a.oldestUnpaidDate, ctx).toBeNull();
      }
      expect(a.units.reduce((s, u) => s + u.due, 0), ctx).toBe(a.totalDebt);
      expect(a.units.every((u) => u.due >= 0 && u.paid >= 0), ctx).toBe(true);
      if (a.units.some((u) => u.key === OVERDRAW_KEY)) overdrawn++;
    }
    // the generator really exercises refunds beyond the credit
    expect(overdrawn).toBeGreaterThan(1000);
  });
});

describe("B7 — refunds above the credit", () => {
  let n = 0;
  const e = (over: Partial<AllocEntry> & Pick<AllocEntry, "type" | "amount" | "date">): AllocEntry => ({ id: `r${++n}`, enrollmentId: null, billingKey: null, reversesId: null, ...over });

  it("payment 600k, charge 600k, refund 900k → the whole 900k is debt", () => {
    const a = allocate([
      e({ type: "CHARGE", amount: -600_000, date: "2026-10-01", enrollmentId: "a", billingKey: "sub:a:2026-10-01" }),
      e({ type: "PAYMENT", amount: 600_000, date: "2026-10-02" }),
      e({ type: "REFUND", amount: -900_000, date: "2026-10-10" }),
    ]);
    expect(a.balance).toBe(-900_000);
    expect(a.totalDebt).toBe(900_000);
    expect(a.units.find((u) => u.key === OVERDRAW_KEY)).toMatchObject({ due: 300_000, firstDate: "2026-10-10", enrollmentId: null });
    expect(a.oldestUnpaidDate).toBe("2026-10-01");
  });

  it("a charge paid by a directed payment, then a refund → debt dated on the refund day (reminders run)", () => {
    const a = allocate([
      e({ type: "CHARGE", amount: -600_000, date: "2026-10-01", enrollmentId: "a", billingKey: "sub:a:2026-10-01" }),
      e({ type: "PAYMENT", amount: 600_000, date: "2026-10-02", enrollmentId: "a" }),
      e({ type: "REFUND", amount: -300_000, date: "2026-10-12" }),
    ]);
    expect(a.balance).toBe(-300_000);
    expect(a.totalDebt).toBe(300_000);
    expect(a.oldestUnpaidDate).toBe("2026-10-12");
    // the enrollment itself is paid; the debt belongs to the family wallet
    expect(a.enrollments.get("a")?.debt).toBe(0);
  });

  it("N5: the overdraw ages from the day the wallet went negative; a reversed payment does not reset it", () => {
    const overdraw = [e({ type: "PAYMENT", amount: 100_000, date: "2026-01-02" }), e({ type: "REFUND", amount: -150_000, date: "2026-01-10" })];
    const pay = e({ type: "PAYMENT", amount: 50_000, date: "2026-03-01" });
    const a = allocate([...overdraw, pay, e({ type: "REVERSAL", amount: -50_000, date: "2026-03-05", reversesId: pay.id })]);
    expect(a.totalDebt).toBe(50_000);
    expect(a.oldestUnpaidDate).toBe("2026-01-10");
    expect(a.units.find((u) => u.key === OVERDRAW_KEY)?.firstDate).toBe("2026-01-10");
    // a partial payment does not end the episode either
    expect(allocate([...overdraw, e({ type: "PAYMENT", amount: 20_000, date: "2026-02-01" })]).oldestUnpaidDate).toBe("2026-01-10");
    // cleared by a real payment, overdrawn again later: a new episode
    const again = allocate([...overdraw, e({ type: "PAYMENT", amount: 50_000, date: "2026-02-01" }), e({ type: "REFUND", amount: -30_000, date: "2026-03-10" })]);
    expect(again).toMatchObject({ totalDebt: 30_000, oldestUnpaidDate: "2026-03-10" });
    // charges unpaid since before the overdraw keep their own (older) date
    const charged = allocate([e({ type: "CHARGE", amount: -200_000, date: "2025-12-01", enrollmentId: "a", billingKey: "sub:a:2025-12-01" }), ...overdraw]);
    expect(charged.totalDebt).toBe(250_000);
    expect(charged.units.find((u) => u.key === OVERDRAW_KEY)?.firstDate).toBe("2026-01-10");
    expect(charged.oldestUnpaidDate).toBe("2025-12-01");
  });

  it("a refund within the credit leaves no debt", () => {
    const a = allocate([e({ type: "PAYMENT", amount: 500_000, date: "2026-10-02" }), e({ type: "REFUND", amount: -500_000, date: "2026-10-03" })]);
    expect(a).toMatchObject({ balance: 0, totalDebt: 0, unallocated: 0, oldestUnpaidDate: null });
    expect(a.units).toEqual([]);
  });
});
