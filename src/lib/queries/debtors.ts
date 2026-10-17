// Debtors (HANDOFF §7 "Debtors list"): read from the family balance cache (billing/balance-cache), which
// holds each family's SUM(ledger) and the oldest unpaid date of its FIFO allocation. Scope, filters,
// sorting and paging are SQL; nothing here reads the ledger except the last payment date.
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/ctx-core";
import { diffDays, toISODate, todayISO } from "@/lib/dates";
import { freshBalances } from "@/lib/billing/balance-cache";
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
/** Families whose display details are loaded per query (CSV export). */
const ROW_BATCH = 500;

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : undefined);

/**
 * The "min debt" filter in so'm, or 0 = no filter. Parsed like every money input (parseMoney): stripping
 * non-digits read "150 000,50" as 15 000 050 and "1,5 mln" as 15. Unparseable or ≤ 0 → no filter.
 */
export function debtMinimum(raw: unknown): number {
  const n = parseMoney(typeof raw === "string" ? raw : "");
  return n !== null && n > 0 ? n : 0;
}

/** Debtor families (balance < 0) of the center in the user's branch scope, with optional filters. Call freshBalances first. */
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
    SELECT b."familyId", (-b.balance)::bigint AS debt, to_char(b."oldestUnpaidDate", 'YYYY-MM-DD') AS oldest, b.dues
    FROM "FamilyBalance" b
    JOIN "Family" f ON f.id = b."familyId" AND f."centerId" = ${ctx.centerId}
    WHERE b."centerId" = ${ctx.centerId} AND b.balance < 0 ${min > 0 ? Prisma.sql`AND -b.balance >= ${min}` : Prisma.empty}
      AND ${familyScopeSql(ctx, "f.id")} ${groupTeacher}`;
}

export interface DebtorFamily {
  familyId: string;
  debt: number;
  /** Oldest unpaid due date of the family's FIFO allocation. */
  oldest: string | null;
  /** Raw cached dues (billing/balance-cache parseDues). */
  dues: unknown;
}

type DebtorSqlRow = { familyId: string; debt: bigint; oldest: string | null; dues: unknown };
const toFamily = (r: DebtorSqlRow): DebtorFamily => ({ familyId: r.familyId, debt: Number(r.debt), oldest: r.oldest, dues: r.dues });

/** Every debtor family in scope, biggest debt first. */
export async function debtorFamilies(ctx: Ctx, f: DebtorFilters = {}): Promise<DebtorFamily[]> {
  await freshBalances(ctx.centerId);
  const rows = await db.$queryRaw<DebtorSqlRow[]>`${debtorBaseSql(ctx, f)} ORDER BY debt DESC, b."familyId" ASC`;
  return rows.map(toFamily);
}

/** One page of the debtors list (biggest debt first) plus totals over every page. */
export async function listDebtors(ctx: Ctx, f: DebtorFilters, opts: { page?: number; pageSize?: number } = {}): Promise<DebtorPage> {
  const size = Math.max(1, Math.min(500, opts.pageSize ?? DEBTORS_PAGE_SIZE));
  await freshBalances(ctx.centerId);
  const base = debtorBaseSql(ctx, f);
  const [agg] = await db.$queryRaw<{ n: number; s: bigint | null }[]>`SELECT COUNT(*)::int AS n, SUM(x.debt)::bigint AS s FROM (${base}) x`;
  const total = agg?.n ?? 0;
  const pages = Math.max(1, Math.ceil(total / size));
  const page = Math.min(Math.max(1, Math.floor(opts.page ?? 1)), pages);
  const slice =
    total === 0
      ? []
      : await db.$queryRaw<DebtorSqlRow[]>`${base} ORDER BY debt DESC, b."familyId" ASC LIMIT ${size} OFFSET ${(page - 1) * size}`;
  const rows = await debtorRows(slice.map(toFamily));
  return { rows, total, totalDebt: Number(agg?.s ?? 0), page, pages };
}

/** Every debtor row (CSV export): families from the cache, display details in batches. */
export async function listAllDebtors(ctx: Ctx, f: DebtorFilters): Promise<DebtorRow[]> {
  const all = await debtorFamilies(ctx, f);
  const out: DebtorRow[] = [];
  for (let i = 0; i < all.length; i += ROW_BATCH) out.push(...(await debtorRows(all.slice(i, i + ROW_BATCH))));
  return out;
}

/** Display rows for families already known to owe, in the given order. */
async function debtorRows(list: DebtorFamily[]): Promise<DebtorRow[]> {
  if (list.length === 0) return [];
  const ids = list.map((x) => x.familyId);
  const families = await db.family.findMany({
    where: { id: { in: ids } },
    include: {
      guardians: { orderBy: { isPrimary: "desc" } },
      students: { include: { enrollments: { where: { endDate: null }, include: { group: { select: { id: true, name: true, code: true } } } } } },
      ledger: { where: { type: "PAYMENT" }, orderBy: { date: "desc" }, take: 1, select: { date: true } },
    },
  });
  const byId = new Map(families.map((x) => [x.id, x]));
  const today = todayISO();
  return list.flatMap(({ familyId, debt, oldest }) => {
    const fam = byId.get(familyId);
    if (!fam) return [];
    const g = fam.guardians[0];
    return [
      {
        familyId,
        familyName: fam.name,
        students: fam.students.map((s) => ({ id: s.id, name: `${s.lastName} ${s.firstName}` })),
        groups: fam.students.flatMap((s) => s.enrollments.map((e) => ({ id: e.group.id, name: `${e.group.name} #${e.group.code}` }))),
        debt,
        daysOverdue: oldest ? Math.max(0, diffDays(today, oldest)) : 0,
        lastPayment: fam.ledger[0] ? toISODate(fam.ledger[0].date) : null,
        phone: g?.phone ?? fam.students.find((s) => s.phone)?.phone ?? null,
        telegram: fam.guardians.some((x) => x.telegramChatId) || fam.students.some((s) => s.telegramChatId),
      },
    ];
  });
}
