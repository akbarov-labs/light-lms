// Debtors (HANDOFF §7 "Debtors list"), audit P1: which families owe and how much is decided in SQL
// (SUM(ledger) per family, scoped and filtered, sorted, paginated); the FIFO allocation that gives
// "days overdue" runs only for the families being shown, in bounded batches.
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/ctx-core";
import { diffDays, toISODate, todayISO } from "@/lib/dates";
import { allocate, type AllocEntry, type Allocation } from "@/lib/billing/allocation";
import { parseMoney } from "@/lib/money";
import { familyScopeSql } from "./scope-sql";

export interface DebtorFilters {
  groupId?: string;
  teacherId?: string;
  min?: string;
}

export interface DebtorRow {
  familyId: string;
  familyName: string;
  students: { id: string; name: string }[];
  groups: { id: string; name: string }[];
  debt: number;
  daysOverdue: number;
  lastPayment: string | null;
  phone: string | null;
  telegram: boolean;
}

export interface DebtorPage {
  rows: DebtorRow[];
  /** Debtor families matching the filters (all pages). */
  total: number;
  /** Their debt in total (all pages). */
  totalDebt: number;
  page: number;
  pages: number;
}

export const DEBTORS_PAGE_SIZE = 50;
/** Families allocated per ledger read (export, aging) — bounds memory on big centers. */
export const ALLOC_BATCH = 500;

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/**
 * The "min debt" filter in so'm, or 0 = no filter. Parsed like every money input (parseMoney): stripping
 * non-digits read "150 000,50" as 15 000 050 and "1,5 mln" as 15. Unparseable or ≤ 0 → no filter.
 */
export function debtMinimum(raw: unknown): number {
  const n = parseMoney(typeof raw === "string" ? raw : "");
  return n !== null && n > 0 ? n : 0;
}

/** Debtor families (balance < 0) of the center in the user's branch scope, with optional filters. */
function debtorBaseSql(ctx: Ctx, f: DebtorFilters = {}): Prisma.Sql {
  const min = debtMinimum(f.min);
  const groupId = str(f.groupId);
  const teacherId = str(f.teacherId);
  const groupTeacher =
    groupId || teacherId
      ? Prisma.sql`AND EXISTS (
          SELECT 1 FROM "Student" gs
          JOIN "Enrollment" ge ON ge."studentId" = gs.id
          JOIN "Group" gg ON gg.id = ge."groupId"
          WHERE gs."familyId" = f.id AND ge."endDate" IS NULL
            ${groupId ? Prisma.sql`AND ge."groupId" = ${groupId}` : Prisma.empty}
            ${teacherId ? Prisma.sql`AND gg."teacherId" = ${teacherId}` : Prisma.empty})`
      : Prisma.empty;
  return Prisma.sql`
    SELECT b."familyId", (-b.bal)::bigint AS debt
    FROM (
      SELECT le."familyId", SUM(le.amount) AS bal
      FROM "LedgerEntry" le
      WHERE le."centerId" = ${ctx.centerId}
      GROUP BY le."familyId"
      HAVING SUM(le.amount) < 0 ${min > 0 ? Prisma.sql`AND -SUM(le.amount) >= ${min}` : Prisma.empty}
    ) b
    JOIN "Family" f ON f.id = b."familyId" AND f."centerId" = ${ctx.centerId}
    WHERE ${familyScopeSql(ctx, "f.id")} ${groupTeacher}`;
}

/** Every debtor family id in scope, biggest debt first (no allocation). */
export async function debtorFamilies(ctx: Ctx, f: DebtorFilters = {}): Promise<{ familyId: string; debt: number }[]> {
  const rows = await db.$queryRaw<{ familyId: string; debt: bigint }[]>`${debtorBaseSql(ctx, f)} ORDER BY debt DESC, b."familyId" ASC`;
  return rows.map((r) => ({ familyId: r.familyId, debt: Number(r.debt) }));
}

/** One page of the debtors list (biggest debt first) plus totals over every page. */
export async function listDebtors(ctx: Ctx, f: DebtorFilters, opts: { page?: number; pageSize?: number } = {}): Promise<DebtorPage> {
  const size = Math.max(1, Math.min(500, opts.pageSize ?? DEBTORS_PAGE_SIZE));
  const base = debtorBaseSql(ctx, f);
  const [agg] = await db.$queryRaw<{ n: number; s: bigint | null }[]>`SELECT COUNT(*)::int AS n, SUM(x.debt)::bigint AS s FROM (${base}) x`;
  const total = agg?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(1, Math.floor(opts.page ?? 1)), pages);
  const slice =
    total === 0
      ? []
      : await db.$queryRaw<{ familyId: string; debt: bigint }[]>`${base} ORDER BY debt DESC, b."familyId" ASC LIMIT ${size} OFFSET ${(page - 1) * size}`;
  const rows = await debtorRows(slice.map((r) => ({ familyId: r.familyId, debt: Number(r.debt) })));
  return { rows, total, totalDebt: Number(agg?.s ?? 0), page, pages };
}

/** Every debtor row (CSV export): ids from SQL, details and allocation in batches. */
export async function listAllDebtors(ctx: Ctx, f: DebtorFilters): Promise<DebtorRow[]> {
  const all = await debtorFamilies(ctx, f);
  const out: DebtorRow[] = [];
  for (let i = 0; i < all.length; i += ALLOC_BATCH) out.push(...(await debtorRows(all.slice(i, i + ALLOC_BATCH))));
  return out;
}

/** Allocation (FIFO, HANDOFF §7) for a batch of families — one ledger read, linear grouping. */
export async function allocateFamilies(familyIds: string[]): Promise<Map<string, Allocation>> {
  const out = new Map<string, Allocation>();
  if (familyIds.length === 0) return out;
  // same rows and order as services/wallet familyAllocation; unit descriptions are not shown here
  const entries = await db.$queryRaw<(AllocEntry & { familyId: string })[]>`
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

/** Display rows for families already known to owe, in the given order. */
async function debtorRows(list: { familyId: string; debt: number }[]): Promise<DebtorRow[]> {
  if (list.length === 0) return [];
  const ids = list.map((x) => x.familyId);
  const [families, allocs] = await Promise.all([
    db.family.findMany({
      where: { id: { in: ids } },
      include: {
        guardians: { orderBy: { isPrimary: "desc" } },
        students: { include: { enrollments: { where: { endDate: null }, include: { group: { select: { id: true, name: true, code: true } } } } } },
        ledger: { where: { type: "PAYMENT" }, orderBy: { date: "desc" }, take: 1, select: { date: true } },
      },
    }),
    allocateFamilies(ids),
  ]);
  const byId = new Map(families.map((x) => [x.id, x]));
  const today = todayISO();
  return list.flatMap(({ familyId, debt }) => {
    const fam = byId.get(familyId);
    if (!fam) return [];
    const a = allocs.get(familyId)!;
    const g = fam.guardians[0];
    return [
      {
        familyId,
        familyName: fam.name,
        students: fam.students.map((s) => ({ id: s.id, name: `${s.lastName} ${s.firstName}` })),
        groups: fam.students.flatMap((s) => s.enrollments.map((e) => ({ id: e.group.id, name: `${e.group.name} #${e.group.code}` }))),
        debt,
        daysOverdue: a.oldestUnpaidDate ? Math.max(0, diffDays(today, a.oldestUnpaidDate)) : 0,
        lastPayment: fam.ledger[0] ? toISODate(fam.ledger[0].date) : null,
        phone: g?.phone ?? fam.students.find((s) => s.phone)?.phone ?? null,
        telegram: fam.guardians.some((x) => x.telegramChatId) || fam.students.some((s) => s.telegramChatId),
      },
    ];
  });
}
