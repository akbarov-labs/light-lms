import { db, type Tx } from "@/lib/db";
import { toISODate } from "@/lib/dates";
import { allocate, type Allocation } from "@/lib/billing/allocation";

export async function familyLedger(familyId: string, tx: Tx = db) {
  return tx.ledgerEntry.findMany({
    where: { familyId },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
    include: { student: { select: { firstName: true, lastName: true } }, reversedBy: { select: { id: true } } },
  });
}

export async function familyAllocation(familyId: string, tx: Tx = db): Promise<Allocation> {
  const entries = await tx.ledgerEntry.findMany({
    where: { familyId },
    select: { id: true, type: true, amount: true, date: true, enrollmentId: true, billingKey: true, reversesId: true, description: true },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  return allocate(entries.map((e) => ({ ...e, date: toISODate(e.date) })));
}

export async function familyBalance(familyId: string, tx: Tx = db): Promise<number> {
  const r = await tx.ledgerEntry.aggregate({ where: { familyId }, _sum: { amount: true } });
  return r._sum.amount ?? 0;
}

/** Balances for many families in one query. */
export async function balancesFor(familyIds: string[], tx: Tx = db): Promise<Map<string, number>> {
  if (familyIds.length === 0) return new Map();
  const rows = await tx.ledgerEntry.groupBy({ by: ["familyId"], where: { familyId: { in: familyIds } }, _sum: { amount: true } });
  return new Map(rows.map((r) => [r.familyId, r._sum.amount ?? 0]));
}

/** Allocation per family for many families (one query). */
export async function allocationsFor(familyIds: string[], tx: Tx = db): Promise<Map<string, Allocation>> {
  const out = new Map<string, Allocation>();
  if (familyIds.length === 0) return out;
  const entries = await tx.ledgerEntry.findMany({
    where: { familyId: { in: familyIds } },
    select: { id: true, familyId: true, type: true, amount: true, date: true, enrollmentId: true, billingKey: true, reversesId: true, description: true },
    orderBy: [{ date: "asc" }, { createdAt: "asc" }],
  });
  const by = new Map<string, typeof entries>();
  for (const e of entries) {
    const list = by.get(e.familyId);
    if (list) list.push(e);
    else by.set(e.familyId, [e]);
  }
  for (const id of familyIds) out.set(id, allocate((by.get(id) ?? []).map((e) => ({ ...e, date: toISODate(e.date) }))));
  return out;
}
