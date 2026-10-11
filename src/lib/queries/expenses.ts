import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { scopeBranchIds, type Ctx } from "@/lib/ctx";
import { fromISODate, isISODate, monthRange, todayISO } from "@/lib/dates";

export function expenseWhere(ctx: Ctx, f: { from?: string; to?: string; category?: string; withReversed?: boolean }): Prisma.ExpenseWhereInput {
  const m = monthRange(todayISO().slice(0, 7));
  const ids = scopeBranchIds(ctx);
  return {
    centerId: ctx.centerId,
    date: { gte: fromISODate(isISODate(f.from) ? f.from : m.start), lte: fromISODate(isISODate(f.to) ? f.to : m.end) },
    ...(f.category ? { category: f.category } : {}),
    ...(f.withReversed ? {} : { reversedAt: null }),
    ...(ids ? { branchId: { in: ids } } : {}),
  };
}

export async function listExpenses(ctx: Ctx, f: { from?: string; to?: string; category?: string }) {
  const rows = await db.expense.findMany({ where: expenseWhere(ctx, { ...f, withReversed: true }), include: { branch: { select: { name: true } } }, orderBy: [{ date: "desc" }, { createdAt: "desc" }] });
  const users = new Map((await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById))] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  return { rows, users, total: rows.filter((r) => !r.reversedAt).reduce((s, r) => s + r.amount, 0) };
}
