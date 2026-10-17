import type { LeadStage } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db";
import { audit } from "@/lib/audit";

const ORDER: LeadStage[] = ["NEW", "CONTACTED", "TRIAL_BOOKED", "TRIAL_DONE", "ENROLLED"];

/** Move the student's open leads forward (never backwards, never out of LOST). */
export async function advanceLeadsForStudent(tx: Tx, centerId: string, studentId: string, stage: LeadStage, userId: string | null): Promise<void> {
  const leads = await tx.lead.findMany({ where: { studentId, centerId, stage: { not: "LOST" } } });
  for (const l of leads) {
    if (ORDER.indexOf(l.stage) >= ORDER.indexOf(stage)) continue;
    await tx.lead.update({ where: { id: l.id }, data: { stage } });
    await audit(tx, { centerId, userId, entity: "Lead", entityId: l.id, action: `stage.${stage}`, before: { stage: l.stage }, after: { stage } });
  }
}
