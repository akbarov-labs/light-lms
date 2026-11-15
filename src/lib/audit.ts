import type { ActorKind, Prisma } from "@/generated/prisma/client";
import type { Tx } from "./db";

export interface AuditInput {
  centerId: string;
  userId?: string | null;
  /** Who made the change. Default: USER when there is a user, otherwise SYSTEM (a background job). */
  actor?: ActorKind;
  entity: string;
  entityId: string;
  action: string;
  before?: unknown;
  after?: unknown;
}

const toJson = (v: unknown): Prisma.InputJsonValue | undefined =>
  v === undefined || v === null ? undefined : (JSON.parse(JSON.stringify(v)) as Prisma.InputJsonValue);

/** Write one audit row. Call inside the same transaction as the change it describes. */
export async function audit(tx: Tx, a: AuditInput): Promise<void> {
  await tx.auditLog.create({
    data: {
      centerId: a.centerId,
      userId: a.userId ?? null,
      actor: a.actor ?? (a.userId ? "USER" : "SYSTEM"),
      entity: a.entity,
      entityId: a.entityId,
      action: a.action,
      before: toJson(a.before),
      after: toJson(a.after),
    },
  });
}
