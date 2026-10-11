import type { Prisma } from "@prisma/client";
import type { Ctx } from "@/lib/ctx-core";
import { fromISODate, isISODate } from "@/lib/dates";

export function auditWhere(ctx: Ctx, f: { entity?: string; userId?: string; action?: string; from?: string; to?: string; entityId?: string; sync?: string }): Prisma.AuditLogWhereInput {
  return {
    centerId: ctx.centerId,
    ...(f.entity ? { entity: f.entity } : {}),
    ...(f.entityId ? { entityId: f.entityId } : {}),
    ...(f.userId ? { userId: f.userId === "system" ? null : f.userId } : {}),
    ...(f.action ? { action: { contains: f.action } } : f.sync ? {} : { action: { not: "billing.sync" } }),
    ...(isISODate(f.from) || isISODate(f.to)
      ? { createdAt: { ...(isISODate(f.from) ? { gte: fromISODate(f.from) } : {}), ...(isISODate(f.to) ? { lt: new Date(fromISODate(f.to).getTime() + 86_400_000) } : {}) } }
      : {}),
  };
}
