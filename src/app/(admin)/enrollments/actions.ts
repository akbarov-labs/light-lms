"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, type ActionState } from "@/lib/action";
import { db } from "@/lib/db";
import { assertBranch, assertStudentAccess, type Ctx } from "@/lib/ctx";
import { formObject, zBool, zDate, zId, zOptDate, zOptInt, zOptMoney, zOptStr } from "@/lib/forms";
import { UserError } from "@/lib/user-error";
import { monthRange, todayISO } from "@/lib/dates";
import {
  activateEnrollment,
  endFreeze,
  enrollStudent,
  freezeEnrollment,
  leaveEnrollment,
  setEnrollmentTerms,
  transferEnrollment,
} from "@/lib/services/enrollments";

const actor = (ctx: Ctx) => ({ userId: ctx.userId, centerId: ctx.centerId });

async function checkEnrollment(ctx: Ctx, enrollmentId: string) {
  const e = await db.enrollment.findUnique({ where: { id: enrollmentId }, include: { group: { select: { centerId: true, branchId: true } } } });
  if (!e || e.group.centerId !== ctx.centerId) throw new UserError("error.notFound");
  assertBranch(ctx, e.group.branchId);
  return e;
}

function done(studentId?: string, groupId?: string) {
  if (studentId) revalidatePath(`/students/${studentId}`);
  if (groupId) revalidatePath(`/groups/${groupId}`);
}

const enrollSchema = z.object({
  studentId: zId,
  groupId: zId,
  startDate: zDate,
  trial: zBool,
  priceOverride: zOptMoney,
  discountPercent: zOptInt(1, 100),
  discountAmount: zOptMoney,
  discountUntil: zOptDate,
  discountReason: zOptStr,
});

export async function enrollAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("students.edit", async (ctx) => {
    const f = enrollSchema.parse(formObject(fd));
    await assertStudentAccess(ctx, f.studentId);
    await enrollStudent(actor(ctx), f, (branchId) => assertBranch(ctx, branchId));
    done(f.studentId, f.groupId);
  });
}

export async function activateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("students.edit", async (ctx) => {
    const f = z.object({ enrollmentId: zId, date: zOptDate }).parse(formObject(fd));
    const e = await checkEnrollment(ctx, f.enrollmentId);
    await activateEnrollment(actor(ctx), f.enrollmentId, f.date);
    done(e.studentId, e.groupId);
  });
}

export async function transferAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("students.edit", async (ctx) => {
    const f = z.object({ enrollmentId: zId, toGroupId: zId, moveDate: zDate }).parse(formObject(fd));
    const e = await checkEnrollment(ctx, f.enrollmentId);
    await transferEnrollment(actor(ctx), f.enrollmentId, f.toGroupId, f.moveDate, (b) => assertBranch(ctx, b));
    done(e.studentId, e.groupId);
    revalidatePath(`/groups/${f.toGroupId}`);
  });
}

export async function freezeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("students.edit", async (ctx) => {
    const f = z.object({ enrollmentId: zId, from: zDate, to: zDate, reason: zOptStr }).parse(formObject(fd));
    const e = await checkEnrollment(ctx, f.enrollmentId);
    await freezeEnrollment(actor(ctx), f.enrollmentId, f.from, f.to, f.reason ?? null);
    done(e.studentId, e.groupId);
  });
}

export async function endFreezeAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("students.edit", async (ctx) => {
    const f = z.object({ freezeId: zId, to: zOptDate }).parse(formObject(fd));
    const fr = await db.enrollmentFreeze.findUnique({ where: { id: f.freezeId } });
    if (!fr) throw new UserError("error.notFound");
    const e = await checkEnrollment(ctx, fr.enrollmentId);
    await endFreeze(actor(ctx), f.freezeId, f.to ?? todayISO());
    done(e.studentId, e.groupId);
  });
}

export async function leaveAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("students.edit", async (ctx) => {
    const f = z.object({ enrollmentId: zId, endDate: zDate, reason: zOptStr }).parse(formObject(fd));
    const e = await checkEnrollment(ctx, f.enrollmentId);
    await leaveEnrollment(actor(ctx), f.enrollmentId, f.endDate, f.reason ?? null);
    done(e.studentId, e.groupId);
  });
}

export async function termsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("students.edit", async (ctx) => {
    const f = z
      .object({ enrollmentId: zId, priceOverride: zOptMoney, discountPercent: zOptInt(0, 100), discountAmount: zOptMoney, discountUntil: zOptDate, discountReason: zOptStr, from: zOptDate })
      .parse(formObject(fd));
    const e = await checkEnrollment(ctx, f.enrollmentId);
    // re-pricing months that already started is a refund decision
    const from = f.from ?? monthRange(todayISO().slice(0, 7)).start;
    if (from < monthRange(todayISO().slice(0, 7)).start && !ctx.can("payments.refund")) throw new UserError("enr.backdateNeedsRefund");
    await setEnrollmentTerms(actor(ctx), f.enrollmentId, {
      priceOverride: f.priceOverride ?? null,
      discountPercent: f.discountPercent || null,
      discountAmount: f.discountAmount || null,
      discountUntil: f.discountUntil ?? null,
      discountReason: f.discountReason ?? null,
    }, from);
    done(e.studentId, e.groupId);
  });
}
