import { db } from "@/lib/db";
import { familyScope, type Ctx } from "@/lib/ctx";
import { diffDays, toISODate, todayISO } from "@/lib/dates";
import { allocationsFor } from "@/lib/services/wallet";

export interface DebtorFilters {
  groupId?: string;
  teacherId?: string;
  min?: string;
}

export interface DebtorRow {
  familyId: string;
  familyName: string;
  students: { id: string; name: string }[];
  groups: { id: string; name: string }[];
  debt: number;
  daysOverdue: number;
  lastPayment: string | null;
  phone: string | null;
  telegram: boolean;
}

/** Families with a negative balance (HANDOFF §7 "Debtors list"). */
export async function listDebtors(ctx: Ctx, f: DebtorFilters): Promise<DebtorRow[]> {
  const neg = await db.ledgerEntry.groupBy({
    by: ["familyId"],
    where: { centerId: ctx.centerId },
    _sum: { amount: true },
    having: { amount: { _sum: { lt: 0 } } },
  });
  if (neg.length === 0) return [];
  const balance = new Map(neg.map((n) => [n.familyId, n._sum.amount ?? 0]));
  const min = Number(String(f.min ?? "").replace(/\D/g, "")) || 0;
  const families = await db.family.findMany({
    where: {
      id: { in: [...balance.keys()] },
      centerId: ctx.centerId,
      ...familyScope(ctx),
      ...(f.groupId || f.teacherId
        ? { students: { some: { enrollments: { some: { endDate: null, ...(f.groupId ? { groupId: f.groupId } : {}), ...(f.teacherId ? { group: { teacherId: f.teacherId } } : {}) } } } } }
        : {}),
    },
    include: {
      guardians: { orderBy: { isPrimary: "desc" } },
      students: { include: { enrollments: { where: { endDate: null }, include: { group: { select: { id: true, name: true, code: true } } } } } },
      ledger: { where: { type: "PAYMENT" }, orderBy: { date: "desc" }, take: 1, select: { date: true } },
    },
  });
  const allocs = await allocationsFor(families.map((x) => x.id));
  const today = todayISO();
  return families
    .map((fam) => {
      const a = allocs.get(fam.id)!;
      const g = fam.guardians[0];
      return {
        familyId: fam.id,
        familyName: fam.name,
        students: fam.students.map((s) => ({ id: s.id, name: `${s.lastName} ${s.firstName}` })),
        groups: fam.students.flatMap((s) => s.enrollments.map((e) => ({ id: e.group.id, name: `${e.group.name} #${e.group.code}` }))),
        debt: -(balance.get(fam.id) ?? 0),
        daysOverdue: a.oldestUnpaidDate ? Math.max(0, diffDays(today, a.oldestUnpaidDate)) : 0,
        lastPayment: fam.ledger[0] ? toISODate(fam.ledger[0].date) : null,
        phone: g?.phone ?? fam.students.find((s) => s.phone)?.phone ?? null,
        telegram: fam.guardians.some((x) => x.telegramChatId) || fam.students.some((s) => s.telegramChatId),
      };
    })
    .filter((r) => r.debt >= min)
    .sort((a, b) => b.debt - a.debt);
}
