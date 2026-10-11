"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { runAction, type ActionState } from "@/lib/action";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { assertBranch, assertFamilyAccess, assertStudentAccess } from "@/lib/ctx";
import { formObject, zBool, zId, zOptDate, zOptId, zOptPhone, zOptStr, zPhone, zStr, zTags } from "@/lib/forms";
import { UserError } from "@/lib/user-error";
import { fromISODate, todayISO } from "@/lib/dates";
import { enrollStudent } from "@/lib/services/enrollments";

const studentFields = {
  firstName: zStr,
  lastName: zStr,
  phone: zOptPhone,
  birthDate: zOptDate,
  gender: z.preprocess((v) => (v === "" ? undefined : v), z.enum(["M", "F"]).optional()),
  source: zOptStr,
  tags: zTags,
  notes: zOptStr,
};

const createSchema = z.object({
  ...studentFields,
  familyId: zOptId,
  guardianName: zOptStr,
  guardianPhone: zOptPhone,
  relation: zOptStr,
  branchId: zOptId,
  groupId: zOptId,
  trial: zBool,
  leadId: zOptId,
});

export async function createStudentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const res = await runAction("students.edit", async (ctx) => {
    const f = createSchema.parse(formObject(fd));
    const branchId = f.branchId ?? ctx.activeBranchId ?? ctx.branchIds?.[0] ?? null;
    if (branchId) assertBranch(ctx, branchId);
    id = await db.$transaction(async (tx) => {
      let familyId = f.familyId ?? null;
      if (familyId) {
        const fam = await tx.family.findFirst({ where: { id: familyId, centerId: ctx.centerId } });
        if (!fam) throw new UserError("error.notFound");
      }
      // Sibling detection: a known guardian phone joins the same family (one wallet).
      if (!familyId && f.guardianPhone) {
        const g = await tx.guardian.findFirst({ where: { phone: f.guardianPhone, family: { centerId: ctx.centerId } } });
        if (g) familyId = g.familyId;
      }
      if (!familyId) {
        const fam = await tx.family.create({ data: { centerId: ctx.centerId, name: `${f.lastName}lar oilasi` } });
        familyId = fam.id;
        const gPhone = f.guardianPhone ?? f.phone;
        if (gPhone) {
          await tx.guardian.create({ data: { familyId, name: f.guardianName ?? `${f.firstName} ${f.lastName}`, phone: gPhone, relation: f.guardianPhone ? (f.relation ?? null) : "self", isPrimary: true } });
        }
      }
      const s = await tx.student.create({
        data: {
          centerId: ctx.centerId,
          familyId,
          branchId,
          firstName: f.firstName,
          lastName: f.lastName,
          phone: f.phone ?? null,
          birthDate: f.birthDate ? fromISODate(f.birthDate) : null,
          gender: f.gender ?? null,
          source: f.source ?? null,
          tags: f.tags,
          notes: f.notes ?? null,
        },
      });
      await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Student", entityId: s.id, action: "create", after: s });
      if (f.leadId) {
        const lead = await tx.lead.findFirst({ where: { id: f.leadId, centerId: ctx.centerId } });
        if (lead) {
          await tx.lead.update({ where: { id: lead.id }, data: { studentId: s.id, stage: f.groupId ? (f.trial ? "TRIAL_BOOKED" : "ENROLLED") : lead.stage } });
          await tx.leadNote.create({ data: { leadId: lead.id, text: `→ ${f.lastName} ${f.firstName}`, createdById: ctx.userId } });
          await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Lead", entityId: lead.id, action: "convert", after: { studentId: s.id } });
        }
      }
      return s.id;
    });
    if (f.groupId) {
      await enrollStudent({ userId: ctx.userId, centerId: ctx.centerId }, { studentId: id, groupId: f.groupId, startDate: todayISO(), trial: f.trial }, (b) => assertBranch(ctx, b));
    }
  });
  if (res?.ok && id) redirect(`/students/${id}`);
  return res;
}

export async function updateStudentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const res = await runAction("students.edit", async (ctx) => {
    const f = z.object({ id: zId, branchId: zOptId, ...studentFields }).parse(formObject(fd));
    id = f.id;
    await assertStudentAccess(ctx, f.id);
    if (f.branchId) assertBranch(ctx, f.branchId);
    await db.$transaction(async (tx) => {
      const before = await tx.student.findUniqueOrThrow({ where: { id: f.id } });
      const after = await tx.student.update({
        where: { id: f.id },
        data: {
          firstName: f.firstName,
          lastName: f.lastName,
          phone: f.phone ?? null,
          birthDate: f.birthDate ? fromISODate(f.birthDate) : null,
          gender: f.gender ?? null,
          source: f.source ?? null,
          tags: f.tags,
          notes: f.notes ?? null,
          branchId: f.branchId ?? before.branchId,
        },
      });
      await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Student", entityId: f.id, action: "update", before, after });
    });
  });
  if (res?.ok && id) redirect(`/students/${id}`);
  return res;
}

export async function toggleStudentArchiveAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("archive", async (ctx) => {
    const id = zId.parse(fd.get("id"));
    await assertStudentAccess(ctx, id);
    const s = await db.student.findUniqueOrThrow({ where: { id } });
    if (s.status === "ACTIVE" && (await db.enrollment.count({ where: { studentId: id, endDate: null } })) > 0) throw new UserError("students.archiveOpen");
    await db.$transaction(async (tx) => {
      await tx.student.update({ where: { id }, data: { status: s.status === "ACTIVE" ? "ARCHIVED" : "ACTIVE" } });
      await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Student", entityId: id, action: s.status === "ACTIVE" ? "archive" : "restore" });
    });
    revalidatePath(`/students/${id}`);
  });
}

const guardianSchema = z.object({ id: zOptId, familyId: zId, name: zStr, phone: zPhone, relation: zOptStr, isPrimary: zBool });

export async function saveGuardianAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("students.edit", async (ctx) => {
    const f = guardianSchema.parse(formObject(fd));
    await assertFamilyAccess(ctx, f.familyId);
    await db.$transaction(async (tx) => {
      if (f.isPrimary) await tx.guardian.updateMany({ where: { familyId: f.familyId }, data: { isPrimary: false } });
      if (f.id) {
        const g = await tx.guardian.findFirst({ where: { id: f.id, familyId: f.familyId } });
        if (!g) throw new UserError("error.notFound");
        const after = await tx.guardian.update({ where: { id: g.id }, data: { name: f.name, phone: f.phone, relation: f.relation ?? null, isPrimary: f.isPrimary } });
        await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Guardian", entityId: g.id, action: "update", before: g, after });
      } else {
        const g = await tx.guardian.create({ data: { familyId: f.familyId, name: f.name, phone: f.phone, relation: f.relation ?? null, isPrimary: f.isPrimary } });
        await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Guardian", entityId: g.id, action: "create", after: g });
      }
    });
    revalidatePath(`/families/${f.familyId}`);
  });
}

export async function renameFamilyAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("students.edit", async (ctx) => {
    const f = z.object({ familyId: zId, name: zStr }).parse(formObject(fd));
    await assertFamilyAccess(ctx, f.familyId);
    await db.family.update({ where: { id: f.familyId }, data: { name: f.name } });
    revalidatePath(`/families/${f.familyId}`);
  });
}
