import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { familyScope, type Ctx } from "@/lib/ctx-core";
import { fromISODate, monthRange, todayISO, isISODate } from "@/lib/dates";

export interface PaymentFilters {
  from?: string;
  to?: string;
  method?: string;
  type?: string;
  cashier?: string;
  q?: string;
}

export function paymentWhere(ctx: Ctx, f: PaymentFilters): Prisma.LedgerEntryWhereInput {
  const month = monthRange(todayISO().slice(0, 7));
  const from = isISODate(f.from) ? f.from : month.start;
  const to = isISODate(f.to) ? f.to : month.end;
  const types =
    f.type === "PAYMENT" ? ["PAYMENT"] : f.type === "REFUND" ? ["REFUND"] : f.type === "REVERSAL" ? ["REVERSAL"] : ["PAYMENT", "REFUND", "REVERSAL"];
  const and: Prisma.LedgerEntryWhereInput[] = [
    { centerId: ctx.centerId },
    { type: { in: types as ("PAYMENT" | "REFUND" | "REVERSAL")[] } },
    { date: { gte: fromISODate(from), lte: fromISODate(to) } },
  ];
  // reversals of charges/credits never appear here — only money movements
  if (types.includes("REVERSAL")) and.push({ OR: [{ type: { not: "REVERSAL" } }, { reverses: { type: { in: ["PAYMENT", "REFUND"] } } }] });
  if (f.method) and.push({ method: f.method as "CASH" });
  if (f.cashier) and.push({ createdById: f.cashier });
  if (f.q)
    and.push({
      family: {
        OR: [
          { name: { contains: f.q, mode: "insensitive" } },
          { students: { some: { OR: [{ firstName: { contains: f.q, mode: "insensitive" } }, { lastName: { contains: f.q, mode: "insensitive" } }] } } },
        ],
      },
    });
  if (ctx.branchIds || ctx.activeBranchId) and.push({ family: familyScope(ctx) });
  return { AND: and };
}

export async function listPayments(ctx: Ctx, f: PaymentFilters, page?: { skip: number; take: number }) {
  const where = paymentWhere(ctx, f);
  const [rows, total, sums] = await Promise.all([
    db.ledgerEntry.findMany({
      where,
      include: { family: { select: { id: true, name: true } }, student: { select: { firstName: true, lastName: true } }, reversedBy: { select: { id: true } } },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      ...(page ?? {}),
    }),
    db.ledgerEntry.count({ where }),
    db.ledgerEntry.groupBy({ by: ["type"], where, _sum: { amount: true } }),
  ]);
  const sum = (t: string) => sums.find((s) => s.type === t)?._sum.amount ?? 0;
  const users = new Map(
    (await db.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.createdById).filter(Boolean))] as string[] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]),
  );
  return { rows, total, users, totals: { payments: sum("PAYMENT"), refunds: sum("REFUND"), reversals: sum("REVERSAL"), net: sum("PAYMENT") + sum("REFUND") + sum("REVERSAL") } };
}
