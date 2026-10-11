"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, type ActionState } from "@/lib/action";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { assertBranch } from "@/lib/ctx";
import { formObject, zDate, zId, zMoney, zOptId, zOptStr, zStr } from "@/lib/forms";
import { fromISODate } from "@/lib/dates";
import { UserError } from "@/lib/user-error";

export async function addExpenseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("finance.view", async (ctx) => {
    const f = z.object({ category: zStr, amount: zMoney, date: zDate, branchId: zOptId, note: zOptStr }).parse(formObject(fd));
    if (f.amount <= 0) throw new UserError("error.amount");
    if (f.branchId) assertBranch(ctx, f.branchId);
    else if (ctx.branchIds) throw new UserError("error.forbidden");
    await db.$transaction(async (tx) => {
      const e = await tx.expense.create({ data: { centerId: ctx.centerId, branchId: f.branchId ?? null, category: f.category, amount: f.amount, date: fromISODate(f.date), note: f.note ?? null, createdById: ctx.userId } });
      await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Expense", entityId: e.id, action: "create", after: e });
    });
    revalidatePath("/expenses");
  });
}

/** Expenses are never deleted: a mistaken one is marked reversed and drops out of totals. */
export async function reverseExpenseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("finance.view", async (ctx) => {
    if (!ctx.can("payments.refund") && !ctx.can("archive")) throw new UserError("error.forbidden");
    const id = zId.parse(fd.get("id"));
    const e = await db.expense.findFirst({ where: { id, centerId: ctx.centerId } });
    if (!e || e.reversedAt) throw new UserError("error.notFound");
    if (e.branchId) assertBranch(ctx, e.branchId);
    else if (ctx.branchIds) throw new UserError("error.forbidden");
    const payslip = await db.payslip.findFirst({ where: { expenseId: id } });
    if (payslip) throw new UserError("error.locked");
    await db.$transaction(async (tx) => {
      await tx.expense.update({ where: { id }, data: { reversedAt: new Date() } });
      await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Expense", entityId: id, action: "reverse", before: e });
    });
    revalidatePath("/expenses");
  });
}
