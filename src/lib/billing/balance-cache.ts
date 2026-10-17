// Family balance cache (FamilyBalance). A trigger on LedgerEntry queues every family whose ledger
// changes in FamilyBalanceDirty, whatever code path wrote it; this module recomputes exactly those
// families with the same FIFO allocation the wallet uses and stores debtSummary(). Readers call
// freshBalances(centerId) first, so what they read always equals allocating the ledger now.
//
// Correctness under concurrency:
// - one refresher per center at a time (advisory lock), so two never write the same family;
// - queue rows are read before the ledger, and only the rows seen are deleted: a ledger write that
//   commits during a refresh leaves its own queue row behind, and the family is recomputed next time.
import { Prisma } from "@/generated/prisma/client";
import { db, type Tx } from "@/lib/db";
import { allocate, debtSummary, type AllocEntry, type Allocation } from "./allocation";

/** Families allocated per ledger read — bounds memory and transaction length. */
export const BALANCE_BATCH = 500;

/** FIFO allocation (HANDOFF §7) for a batch of families — one ledger read, same order as the wallet. */
export async function allocateFamilies(familyIds: string[], client: Tx = db): Promise<Map<string, Allocation>> {
  const out = new Map<string, Allocation>();
  if (familyIds.length === 0) return out;
  const entries = await client.$queryRaw<(AllocEntry & { familyId: string })[]>`
    SELECT le.id, le."familyId", le.type::text AS type, le.amount, to_char(le.date, 'YYYY-MM-DD') AS date,
           le."enrollmentId", le."billingKey", le."reversesId"
    FROM "LedgerEntry" le
    WHERE le."familyId" IN (${Prisma.join(familyIds)})
    ORDER BY le.date ASC, le."createdAt" ASC`;
  const by = new Map<string, AllocEntry[]>();
  for (const e of entries) {
    let list = by.get(e.familyId);
    if (!list) by.set(e.familyId, (list = []));
    list.push(e);
  }
  for (const id of familyIds) out.set(id, allocate(by.get(id) ?? []));
  return out;
}

/** Recompute one batch of the center's queued families. Returns how many families it took. */
async function refreshBatch(centerId: string, batch: number): Promise<number> {
  return db.$transaction(
    async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`family-balance:${centerId}`}))`;
      const queued = await tx.$queryRaw<{ id: bigint; familyId: string }[]>`
        WITH f AS (SELECT DISTINCT "familyId" FROM "FamilyBalanceDirty" WHERE "centerId" = ${centerId} LIMIT ${batch})
        SELECT d.id, d."familyId" FROM "FamilyBalanceDirty" d JOIN f USING ("familyId") WHERE d."centerId" = ${centerId}`;
      if (queued.length === 0) return 0;
      const ids = [...new Set(queued.map((q) => q.familyId))];
      // a deleted family (its ledger went first) only leaves queue rows behind
      const live = (await tx.family.findMany({ where: { id: { in: ids } }, select: { id: true } })).map((f) => f.id);
      const allocs = await allocateFamilies(live, tx);
      if (live.length) {
        const rows = live.map((id) => {
          const s = debtSummary(allocs.get(id)!);
          return Prisma.sql`(${id}, ${centerId}, ${s.balance}, ${s.totalDebt}, ${s.oldestUnpaidDate}::date, ${JSON.stringify(s.dues.map((d) => ({ d: d.date, a: d.amount })))}::jsonb, now())`;
        });
        await tx.$executeRaw`
          INSERT INTO "FamilyBalance" ("familyId", "centerId", "balance", "totalDebt", "oldestUnpaidDate", "dues", "updatedAt")
          VALUES ${Prisma.join(rows)}
          ON CONFLICT ("familyId") DO UPDATE SET "centerId" = EXCLUDED."centerId", "balance" = EXCLUDED."balance",
            "totalDebt" = EXCLUDED."totalDebt", "oldestUnpaidDate" = EXCLUDED."oldestUnpaidDate", "dues" = EXCLUDED."dues", "updatedAt" = now()`;
      }
      await tx.$executeRaw`DELETE FROM "FamilyBalanceDirty" WHERE id = ANY(${queued.map((q) => String(q.id))}::bigint[])`;
      return ids.length;
    },
    { timeout: 120_000, maxWait: 30_000 },
  );
}

/**
 * Bring the center's cache up to date. Cheap when nothing is queued (one index probe), so every
 * reader calls it. Returns the number of families recomputed.
 */
export async function freshBalances(centerId: string, batch = BALANCE_BATCH): Promise<number> {
  const [any] = await db.$queryRaw<{ n: number }[]>`SELECT 1 AS n FROM "FamilyBalanceDirty" WHERE "centerId" = ${centerId} LIMIT 1`;
  if (!any) return 0;
  let total = 0;
  for (let n = await refreshBatch(centerId, batch); n > 0; n = await refreshBatch(centerId, batch)) total += n;
  return total;
}

/** Every center with queued families (worker: after billing, and every few minutes). */
export async function refreshAllBalances(): Promise<{ balancesRefreshed: number; balanceCenters: number }> {
  const centers = await db.$queryRaw<{ centerId: string }[]>`SELECT DISTINCT "centerId" FROM "FamilyBalanceDirty"`;
  let n = 0;
  for (const c of centers) n += await freshBalances(c.centerId);
  return { balancesRefreshed: n, balanceCenters: centers.length };
}

/** The cached "dues" column as { date, amount } (oldest first). */
export function parseDues(json: unknown): { date: string; amount: number }[] {
  return Array.isArray(json) ? json.map((d: { d: string; a: number }) => ({ date: d.d, amount: Number(d.a) })) : [];
}
