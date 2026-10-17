"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { runAction, type ActionState } from "@/lib/action";
import { db } from "@/lib/db";
import { assertFamilyAccess } from "@/lib/ctx";
import { formObject, zBool, zDate, zId, zMoney, zOptId, zOptStr } from "@/lib/forms";
import { formatMoney, LARGE_PAYMENT, needsLargeConfirm, parseMoney } from "@/lib/money";
import { UserError } from "@/lib/user-error";
import { refund, reversePayment, takePayment } from "@/lib/services/payments";

const METHODS = z.enum(["CASH", "CARD", "TRANSFER"]);

export async function takePaymentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let entryId = "";
  const res = await runAction("payments.take", async (ctx) => {
    const raw = formObject(fd);
    if (parseMoney(raw.amount) === null) throw new UserError("money.badAmount");
    const f = z.object({ familyId: zId, amount: zMoney, method: METHODS, date: zDate, enrollmentId: zOptId, studentId: zOptId, note: zOptStr, confirmLarge: zBool }).parse(raw);
    if (f.amount <= 0) throw new UserError("error.amount");
    // typo guard: a very large single payment must be confirmed explicitly on the form
    if (needsLargeConfirm(f.amount, f.confirmLarge)) throw new UserError("money.largeNeedsConfirm", { limit: formatMoney(LARGE_PAYMENT) });
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
    if (entry.method === "PAYME") throw new UserError("pay.paymeNoReverse");
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
