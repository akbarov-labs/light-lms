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
import { createStudentWithFamily } from "@/lib/services/students";
import { unlinkIfPhoneChanged } from "@/lib/telegram-links";

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
    if (f.familyId) await assertFamilyAccess(ctx, f.familyId);
    id = await db.$transaction((tx) =>
      createStudentWithFamily(
        tx,
        { userId: ctx.userId, centerId: ctx.centerId, actor: "USER" },
        { ...f, branchId, leadStage: f.groupId ? (f.trial ? "TRIAL_BOOKED" : "ENROLLED") : undefined },
        // Sibling detection: a known guardian phone joins the same family (one wallet) —
        // only a family this user may already see, so nobody gains another branch's wallet.
        { canJoinFamily: (familyId) => assertFamilyAccess(ctx, familyId).then(() => true, () => false) },
      ),
    );
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
      // the chat that proved the old phone stops getting this student's data (S3)
      const unlinked = await unlinkIfPhoneChanged(tx, "STUDENT", f.id, before.phone, after.phone);
      await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Student", entityId: f.id, action: "update", before, after: { ...after, telegramUnlinked: unlinked || undefined } });
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
        // the old phone's chat stops getting the family's balance and attendance (S3)
        const unlinked = await unlinkIfPhoneChanged(tx, "GUARDIAN", g.id, g.phone, after.phone);
        await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Guardian", entityId: g.id, action: "update", before: g, after: { ...after, telegramUnlinked: unlinked || undefined } });
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
