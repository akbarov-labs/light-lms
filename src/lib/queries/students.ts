// Student list filtering in SQL: search (trigram-indexed), status, group, "has debt" — one statement,
// no id lists passed back and forth (audit P1 "students?debt=1", P4). Pages then load the rows by id.
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/ctx-core";
import { studentSearchSql } from "@/lib/search";
import { studentScopeSql } from "./scope-sql";

export interface StudentFilters {
  q?: string;
  /** undefined = any status */
  status?: "ACTIVE" | "ARCHIVED";
  groupId?: string;
  /** only students whose family balance is negative */
  debt?: boolean;
}

/** WHERE for a student row aliased `s` in the center and the user's branch scope. */
export function studentWhereSql(ctx: Ctx, f: StudentFilters): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`s."centerId" = ${ctx.centerId}`, studentScopeSql(ctx, "s"), studentSearchSql(f.q, ctx.centerId, "s")];
  if (f.status) parts.push(Prisma.sql`s.status = ${f.status}::"StudentStatus"`);
  if (f.groupId) parts.push(Prisma.sql`EXISTS (SELECT 1 FROM "Enrollment" fe WHERE fe."studentId" = s.id AND fe."groupId" = ${f.groupId} AND fe."endDate" IS NULL)`);
  // one pass over the (centerId, familyId) INCLUDE (amount) index, hashed — not an id list from the app
  if (f.debt) {
    parts.push(Prisma.sql`s."familyId" IN (SELECT dl."familyId" FROM "LedgerEntry" dl WHERE dl."centerId" = ${ctx.centerId} GROUP BY dl."familyId" HAVING SUM(dl.amount) < 0)`);
  }
  return Prisma.join(parts, " AND ");
}

/** Ids of matching students, ordered by last name, first name (then id), plus the total count. */
export async function studentIds(ctx: Ctx, f: StudentFilters, page?: { skip: number; take: number; count?: boolean }): Promise<{ ids: string[]; total: number }> {
  const where = studentWhereSql(ctx, f);
  const limit = page ? Prisma.sql`LIMIT ${page.take} OFFSET ${page.skip}` : Prisma.empty;
  const [rows, count] = await Promise.all([
    db.$queryRaw<{ id: string }[]>`SELECT s.id FROM "Student" s WHERE ${where} ORDER BY s."lastName" ASC, s."firstName" ASC, s.id ASC ${limit}`,
    page && page.count !== false ? db.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM "Student" s WHERE ${where}` : Promise.resolve(null),
  ]);
  return { ids: rows.map((r) => r.id), total: count ? (count[0]?.n ?? 0) : rows.length };
}

/** Load Prisma rows for ids and return them in the ids' order. */
export function inOrder<T extends { id: string }>(ids: string[], rows: T[]): T[] {
  const by = new Map(rows.map((r) => [r.id, r]));
  return ids.flatMap((id) => by.get(id) ?? []);
}
