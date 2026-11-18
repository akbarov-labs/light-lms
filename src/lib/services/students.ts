// Student creation, shared by the admin form and the AI lead agent so both follow the same rules:
// family + primary guardian, sibling detection by guardian phone, lead conversion, audit.
import type { ActorKind, LeadStage } from "@/generated/prisma/client";
import type { Tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { fromISODate, type ISODate } from "@/lib/dates";

export interface StudentActor {
  userId: string | null;
  centerId: string;
  actor: ActorKind;
}

export interface NewStudent {
  firstName: string;
  lastName: string;
  phone?: string | null;
  birthDate?: ISODate | null;
  gender?: "M" | "F" | null;
  /** school class 1–11 (homework routing) */
  schoolGrade?: number | null;
  source?: string | null;
  tags?: string[];
  notes?: string | null;
  branchId: string | null;
  /** an existing family the caller already checked access to */
  familyId?: string | null;
  guardianName?: string | null;
  guardianPhone?: string | null;
  relation?: string | null;
  /** convert this lead: link it to the new student and move it to `leadStage` */
  leadId?: string | null;
  leadStage?: LeadStage;
}

export interface CreateStudentOptions {
  /**
   * Sibling detection: may a known guardian phone join that family (one wallet)? Without it a new family
   * is always created. Callers must only allow families the actor may already see.
   */
  canJoinFamily?: (familyId: string) => Promise<boolean>;
}

/** Create a student (and family + guardian when needed). Returns the student id. */
export async function createStudentWithFamily(tx: Tx, a: StudentActor, s: NewStudent, opts: CreateStudentOptions = {}): Promise<string> {
  let familyId = s.familyId ?? null;
  if (!familyId && s.guardianPhone && opts.canJoinFamily) {
    const g = await tx.guardian.findFirst({ where: { phone: s.guardianPhone, family: { centerId: a.centerId } } });
    if (g && (await opts.canJoinFamily(g.familyId))) familyId = g.familyId;
  }
  if (!familyId) {
    const fam = await tx.family.create({ data: { centerId: a.centerId, name: `${s.lastName}lar oilasi` } });
    familyId = fam.id;
    const gPhone = s.guardianPhone ?? s.phone;
    if (gPhone) {
      await tx.guardian.create({
        data: { familyId, name: s.guardianName ?? `${s.firstName} ${s.lastName}`, phone: gPhone, relation: s.guardianPhone ? (s.relation ?? null) : "self", isPrimary: true },
      });
    }
  }
  const student = await tx.student.create({
    data: {
      centerId: a.centerId,
      familyId,
      branchId: s.branchId,
      firstName: s.firstName,
      lastName: s.lastName,
      phone: s.phone ?? null,
      birthDate: s.birthDate ? fromISODate(s.birthDate) : null,
      gender: s.gender ?? null,
      schoolGrade: s.schoolGrade ?? null,
      source: s.source ?? null,
      tags: s.tags ?? [],
      notes: s.notes ?? null,
    },
  });
  await audit(tx, { centerId: a.centerId, userId: a.userId, actor: a.actor, entity: "Student", entityId: student.id, action: "create", after: student });
  if (s.leadId) {
    const lead = await tx.lead.findFirst({ where: { id: s.leadId, centerId: a.centerId } });
    if (lead) {
      await tx.lead.update({ where: { id: lead.id }, data: { studentId: student.id, stage: s.leadStage ?? lead.stage } });
      await tx.leadNote.create({ data: { leadId: lead.id, text: `→ ${s.lastName} ${s.firstName}`, createdById: a.userId, actor: a.actor } });
      await audit(tx, { centerId: a.centerId, userId: a.userId, actor: a.actor, entity: "Lead", entityId: lead.id, action: "convert", after: { studentId: student.id } });
    }
  }
  return student.id;
}
