// SQL twins of the Prisma scope helpers in ctx-core (studentScope / familyScope), for raw report queries.
// Keep them in step with ctx-core: a student is in scope by home branch OR any enrollment in a scoped branch.
// Written as uncorrelated IN (…) sets so Postgres hashes them once instead of probing per row.
import { Prisma } from "@prisma/client";
import { scopeBranchIds, type Ctx } from "@/lib/ctx-core";

/** Students enrolled (ever) in a group of these branches. */
function enrolledIn(ids: string[]): Prisma.Sql {
  return Prisma.sql`SELECT se."studentId" FROM "Enrollment" se JOIN "Group" sg ON sg.id = se."groupId" WHERE sg."branchId" IN (${Prisma.join(ids)})`;
}

/** `studentScope(ctx)` for a student row aliased `s` (TRUE when unscoped). */
export function studentScopeSql(ctx: Ctx, s: string): Prisma.Sql {
  const ids = scopeBranchIds(ctx);
  if (!ids) return Prisma.sql`TRUE`;
  if (ids.length === 0) return Prisma.sql`FALSE`;
  const a = Prisma.raw(`"${s}"`);
  return Prisma.sql`(${a}."branchId" IN (${Prisma.join(ids)}) OR ${a}.id IN (${enrolledIn(ids)}))`;
}

/** `familyScope(ctx)` for a family id expression (e.g. `f.id` or `le."familyId"`). */
export function familyScopeSql(ctx: Ctx, familyIdExpr: string): Prisma.Sql {
  const ids = scopeBranchIds(ctx);
  if (!ids) return Prisma.sql`TRUE`;
  if (ids.length === 0) return Prisma.sql`FALSE`;
  return Prisma.sql`${Prisma.raw(familyIdExpr)} IN (
    SELECT fs."familyId" FROM "Student" fs WHERE fs."branchId" IN (${Prisma.join(ids)})
    UNION
    SELECT fs."familyId" FROM "Student" fs WHERE fs.id IN (${enrolledIn(ids)}))`;
}
