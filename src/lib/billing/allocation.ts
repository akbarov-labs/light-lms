// Family wallet allocation — HANDOFF §7 "Payments, wallet, debt". Pure.
// Balance is SUM(ledger). For display we allocate money to charges FIFO:
//   1) payments directed at an enrollment pay that enrollment's oldest charges,
//   2) everything else (undirected payments, surplus credits, leftovers) pays the family's
//      oldest outstanding charges by date.

import type { ISODate } from "@/lib/dates";

export interface AllocEntry {
  id: string;
  type: "CHARGE" | "CREDIT" | "PAYMENT" | "REFUND" | "REVERSAL";
  amount: number;
  date: ISODate;
  enrollmentId: string | null;
  billingKey: string | null;
  reversesId: string | null;
  description?: string;
}

export interface UnitStatus {
  key: string;
  enrollmentId: string | null;
  /** Net amount owed for the unit (charges − credits). */
  charged: number;
  paid: number;
  due: number;
  firstDate: ISODate;
  description: string;
}

export interface EnrollmentBalance {
  enrollmentId: string;
  charged: number;
  paid: number;
  debt: number;
}

export interface Allocation {
  /** SUM(ledger). Negative = debt. */
  balance: number;
  /** Money not yet used by any charge (prepayment). */
  unallocated: number;
  units: UnitStatus[];
  enrollments: Map<string, EnrollmentBalance>;
  /** Date of the oldest charge that is not fully paid. */
  oldestUnpaidDate: ISODate | null;
  totalDebt: number;
}

/** Debt unit for money paid out beyond the family's credit (see allocate). */
export const OVERDRAW_KEY = "wallet:overdraw";

/**
 * Invariant (property-tested): unallocated − totalDebt = balance, and never both > 0 —
 * balance ≥ 0 ⇒ totalDebt = 0 and unallocated = balance; balance < 0 ⇒ totalDebt = −balance.
 */
export function allocate(entries: AllocEntry[]): Allocation {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const units = new Map<string, UnitStatus>();
  const directed = new Map<string, number>();
  let pool = 0;
  let balance = 0;

  const unitFor = (key: string, e: AllocEntry): UnitStatus => {
    let u = units.get(key);
    if (!u) {
      u = { key, enrollmentId: e.enrollmentId, charged: 0, paid: 0, due: 0, firstDate: e.date, description: e.description ?? "" };
      units.set(key, u);
    }
    if (e.date < u.firstDate) u.firstDate = e.date;
    // the latest recalculation describes the unit as it stands now ("… · 1/13 dars")
    const d = e.description?.replace(/^Qayta hisob · /, "");
    if (d && d !== "bekor qilindi") u.description = d;
    return u;
  };

  const addMoney = (enrollmentId: string | null, amount: number) => {
    if (enrollmentId) directed.set(enrollmentId, (directed.get(enrollmentId) ?? 0) + amount);
    else pool += amount;
  };

  // last day money left the wallet (refund, reversed payment): when an overdraw becomes debt
  let lastOut: ISODate | null = null;
  let lastDate: ISODate | null = null;
  for (const e of entries) {
    balance += e.amount;
    if (!lastDate || e.date > lastDate) lastDate = e.date;
    // A reversal behaves like the entry it reverses, with the opposite sign.
    const kind = e.type === "REVERSAL" ? (e.reversesId ? byId.get(e.reversesId) : undefined) : e;
    const kindType = kind?.type ?? "PAYMENT";
    const key = kind?.billingKey ?? null;
    const enrollmentId = kind?.enrollmentId ?? e.enrollmentId;

    if (kindType === "CHARGE" || (kindType === "CREDIT" && key)) {
      const u = unitFor(key ?? `entry:${kind?.id ?? e.id}`, { ...e, enrollmentId });
      u.charged += -e.amount;
    } else {
      // PAYMENT, REFUND, keyless CREDIT, or their reversals: money in/out of the wallet
      addMoney(kindType === "CREDIT" ? null : enrollmentId, e.amount);
      if (e.amount < 0 && (!lastOut || e.date > lastOut)) lastOut = e.date;
    }
  }

  const byDate = (a: UnitStatus, b: UnitStatus) => (a.firstDate === b.firstDate ? a.key.localeCompare(b.key) : a.firstDate.localeCompare(b.firstDate));
  const list = [...units.values()].sort(byDate);
  for (const u of list) {
    if (u.charged <= 0) {
      pool += -u.charged;
      u.due = 0;
    } else {
      u.due = u.charged;
    }
  }

  const pay = (u: UnitStatus, money: number): number => {
    if (money <= 0 || u.due <= 0) return money;
    const x = Math.min(money, u.due);
    u.paid += x;
    u.due -= x;
    return money - x;
  };

  for (const [enrollmentId, money] of directed) {
    let left = money;
    for (const u of list) if (u.enrollmentId === enrollmentId) left = pay(u, left);
    pool += left;
  }
  for (const u of list) pool = pay(u, pool);

  // More money went out than came in (a refund above the credit): that gap is debt too, so
  // totalDebt = −balance whenever the balance is negative and the family gets reminders.
  if (pool < 0) {
    const firstDate = lastOut ?? lastDate ?? "1970-01-01";
    list.push({ key: OVERDRAW_KEY, enrollmentId: null, charged: -pool, paid: 0, due: -pool, firstDate, description: "Balansdan ortiq qaytarildi" });
    list.sort(byDate);
    pool = 0;
  }

  const enrollments = new Map<string, EnrollmentBalance>();
  let totalDebt = 0;
  let oldestUnpaidDate: ISODate | null = null;
  for (const u of list) {
    totalDebt += u.due;
    if (u.due > 0 && (!oldestUnpaidDate || u.firstDate < oldestUnpaidDate)) oldestUnpaidDate = u.firstDate;
    if (!u.enrollmentId) continue;
    const eb = enrollments.get(u.enrollmentId) ?? { enrollmentId: u.enrollmentId, charged: 0, paid: 0, debt: 0 };
    eb.charged += u.charged;
    eb.paid += u.paid;
    eb.debt += u.due;
    enrollments.set(u.enrollmentId, eb);
  }

  return { balance, unallocated: Math.max(0, pool), units: list, enrollments, oldestUnpaidDate, totalDebt };
}
