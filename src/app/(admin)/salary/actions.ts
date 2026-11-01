"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, type ActionState } from "@/lib/action";
import { formObject, zDate, zId, zMonth, zOptInt, zOptMoney, zStr } from "@/lib/forms";
import { UserError } from "@/lib/user-error";
import { parseMoney } from "@/lib/money";
import { addAdjustment, lockPayslip, markPayslipPaid, setSalaryRule, unlockPayslip } from "@/lib/salary/service";
import { normalizeRule } from "@/lib/salary/engine";
import { assertTeacherAccess, type Ctx } from "@/lib/ctx";

const actor = (ctx: Ctx) => ({ userId: ctx.userId, centerId: ctx.centerId });

export async function saveRuleAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("finance.view", async (ctx) => {
    const f = z
      .object({ teacherId: zId, model: z.enum(["PERCENT_EARNED", "FIXED", "PER_LESSON", "BASE_PLUS_PERCENT"]), percent: zOptInt(0, 100), fixedAmount: zOptMoney, perLesson: zOptMoney, validFrom: zDate })
      .parse(formObject(fd));
    await assertTeacherAccess(ctx, f.teacherId);
    await setSalaryRule(actor(ctx), f.teacherId, { ...normalizeRule(f.model, f), validFrom: f.validFrom });
    revalidatePath(`/salary/${f.teacherId}`);
  });
}

export async function adjustmentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("finance.view", async (ctx) => {
    const f = z.object({ teacherId: zId, month: zMonth, amount: zStr, reason: zStr }).parse(formObject(fd));
    await assertTeacherAccess(ctx, f.teacherId);
    const amount = parseMoney(f.amount.replace(/^[-−]/, "-"));
    if (amount === null || amount === 0) throw new UserError("error.amount");
    await addAdjustment(actor(ctx), f.teacherId, f.month, amount, f.reason);
    revalidatePath(`/salary/${f.teacherId}`);
  });
}

export async function payslipAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("finance.view", async (ctx) => {
    const f = z.object({ teacherId: zId, month: zMonth, op: z.enum(["lock", "unlock", "paid"]) }).parse(formObject(fd));
    await assertTeacherAccess(ctx, f.teacherId);
    if (f.op === "lock") await lockPayslip(actor(ctx), f.teacherId, f.month);
    if (f.op === "unlock") await unlockPayslip(actor(ctx), f.teacherId, f.month);
    if (f.op === "paid") await markPayslipPaid(actor(ctx), f.teacherId, f.month);
    revalidatePath(`/salary/${f.teacherId}`);
    revalidatePath("/salary");
  });
}
