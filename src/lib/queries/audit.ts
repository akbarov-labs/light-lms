// Audit journal queries. The journal hides the high-volume `billing.sync` rows unless asked; the
// page query is shaped for the partial index AuditLog(centerId, createdAt) WHERE action <> 'billing.sync'
// (audit P5): the predicate is a literal (a bound parameter can't prove a partial index applies).
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { Ctx } from "@/lib/ctx-core";
import { isISODate } from "@/lib/dates";
import { zonedDayStart, zonedRange } from "./period";
import { strParam } from "./params";

export interface AuditFilters {
  entity?: string;
  userId?: string;
  action?: string;
  from?: string;
  to?: string;
  entityId?: string;
  sync?: string;
}

/** Prisma filter (CSV export). Day boundaries are center-timezone days. */
export function auditWhere(ctx: Ctx, f: AuditFilters): Prisma.AuditLogWhereInput {
  const action = strParam(f.action);
  const from = isISODate(f.from) ? f.from : undefined;
  const to = isISODate(f.to) ? f.to : undefined;
  return {
    centerId: ctx.centerId,
    ...(strParam(f.entity) ? { entity: strParam(f.entity) } : {}),
    ...(strParam(f.entityId) ? { entityId: strParam(f.entityId) } : {}),
    ...(strParam(f.userId) ? { userId: f.userId === "system" ? null : strParam(f.userId) } : {}),
    // an explicit action filter searches every action (billing.sync included), as before
    ...(action ? { action: { contains: action } } : f.sync ? {} : { action: { not: "billing.sync" } }),
    ...(from || to ? { createdAt: { ...(from ? { gte: zonedDayStart(from) } : {}), ...(to ? { lt: zonedRange(to, to).lt } : {}) } } : {}),
  };
}

/** `timestamp(3)` columns hold UTC wall time: compare against the UTC wall time of the instant. */
const ts = (d: Date) => Prisma.sql`${d.toISOString().slice(0, 23).replace("T", " ")}::timestamp`;

function auditWhereSql(ctx: Ctx, f: AuditFilters): Prisma.Sql {
  const parts: Prisma.Sql[] = [Prisma.sql`a."centerId" = ${ctx.centerId}`];
  const entity = strParam(f.entity);
  const entityId = strParam(f.entityId);
  const userId = strParam(f.userId);
  const action = strParam(f.action);
  // literal predicate = the partial index's; an explicit action filter searches every action, as before
  if (!f.sync && !action) parts.push(Prisma.sql`a.action <> 'billing.sync'`);
  if (entity) parts.push(Prisma.sql`a.entity = ${entity}`);
  if (entityId) parts.push(Prisma.sql`a."entityId" = ${entityId}`);
  if (userId) parts.push(userId === "system" ? Prisma.sql`a."userId" IS NULL` : Prisma.sql`a."userId" = ${userId}`);
  if (action) parts.push(Prisma.sql`strpos(a.action, ${action}) > 0`);
  if (isISODate(f.from)) parts.push(Prisma.sql`a."createdAt" >= ${ts(zonedDayStart(f.from))}`);
  if (isISODate(f.to)) parts.push(Prisma.sql`a."createdAt" < ${ts(zonedRange(f.to, f.to).lt)}`);
  return Prisma.join(parts, " AND ");
}

export interface AuditRow {
  id: string;
  userId: string | null;
  entity: string;
  entityId: string;
  action: string;
  before: Prisma.JsonValue;
  after: Prisma.JsonValue;
  createdAt: Date;
}

/** Rows counted ahead of the current page: enough for the pager, never a full scan of a huge journal. */
export const AUDIT_COUNT_AHEAD = 1000;

/**
 * One page of the journal, newest first. `total` is exact when `exact`, otherwise a lower bound
 * (the count stops AUDIT_COUNT_AHEAD rows past this page — the pager still always offers "next").
 */
export async function listAudit(ctx: Ctx, f: AuditFilters, page: number, size = 50): Promise<{ rows: AuditRow[]; total: number; exact: boolean }> {
  const where = auditWhereSql(ctx, f);
  const skip = (page - 1) * size;
  const cap = skip + size + AUDIT_COUNT_AHEAD;
  const [rows, counted] = await Promise.all([
    db.$queryRaw<AuditRow[]>`
      SELECT a.id, a."userId", a.entity, a."entityId", a.action, a.before, a.after, a."createdAt"
      FROM "AuditLog" a WHERE ${where}
      ORDER BY a."createdAt" DESC, a.id DESC
      LIMIT ${size} OFFSET ${skip}`,
    db.$queryRaw<{ n: number }[]>`SELECT COUNT(*)::int AS n FROM (SELECT 1 FROM "AuditLog" a WHERE ${where} LIMIT ${cap + 1}) x`,
  ]);
  const n = counted[0]?.n ?? 0;
  return { rows, total: Math.min(n, cap), exact: n <= cap };
}
