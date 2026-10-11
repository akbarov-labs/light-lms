"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { runAction, type ActionState } from "@/lib/action";
import { db } from "@/lib/db";
import { assertFamilyAccess } from "@/lib/ctx";
import { formObject, zDate, zId, zMoney, zOptId, zOptStr } from "@/lib/forms";
import { UserError } from "@/lib/user-error";
import { refund, reversePayment, takePayment } from "@/lib/services/payments";

const METHODS = z.enum(["CASH", "CARD", "TRANSFER"]);

export async function takePaymentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let entryId = "";
  const res = await runAction("payments.take", async (ctx) => {
    const f = z.object({ familyId: zId, amount: zMoney, method: METHODS, date: zDate, enrollmentId: zOptId, studentId: zOptId, note: zOptStr }).parse(formObject(fd));
    if (f.amount <= 0) throw new UserError("error.amount");
    await assertFamilyAccess(ctx, f.familyId);
    const entry = await takePayment({ userId: ctx.userId, centerId: ctx.centerId }, { ...f, enrollmentId: f.enrollmentId ?? null, studentId: f.studentId ?? null, note: f.note ?? null });
    entryId = entry.id;
  });
  if (res?.ok && entryId) redirect(`/r/${entryId}`);
  return res;
}

export async function reverseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("payments.refund", async (ctx) => {
    const f = z.object({ entryId: zId, reason: zOptStr }).parse(formObject(fd));
    const entry = await db.ledgerEntry.findFirst({ where: { id: f.entryId, centerId: ctx.centerId } });
    if (!entry) throw new UserError("error.notFound");
    await assertFamilyAccess(ctx, entry.familyId);
    await reversePayment({ userId: ctx.userId, centerId: ctx.centerId }, f.entryId, f.reason ?? null);
    revalidatePath(`/families/${entry.familyId}`);
    revalidatePath("/payments");
  });
}

export async function refundAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("payments.refund", async (ctx) => {
    const f = z.object({ familyId: zId, amount: zMoney, method: METHODS, date: zDate, reason: zOptStr }).parse(formObject(fd));
    await assertFamilyAccess(ctx, f.familyId);
    await refund({ userId: ctx.userId, centerId: ctx.centerId }, { ...f, reason: f.reason ?? null });
    revalidatePath(`/families/${f.familyId}`);
  });
}
