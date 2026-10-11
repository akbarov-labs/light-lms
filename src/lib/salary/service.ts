// DB side of salaries: load a teacher's month, lock it, mark it paid (HANDOFF §8).
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { fromISODate, minDate, monthRange, toISODate, todayISO } from "@/lib/dates";
import { loadGroupInputs } from "@/lib/billing/sync";
import { readSettings } from "@/lib/settings";
import { allocationsFor } from "@/lib/services/wallet";
import { UserError } from "@/lib/user-error";
import type { Actor } from "@/lib/services/enrollments";
import { collectLessons, computeSalary, type HeldLesson, type SalaryResult, type SalaryRule } from "./engine";

export const SALARY_CATEGORY = "Oylik / Salary";

export async function ruleFor(teacherId: string, month: string) {
  return db.salaryRule.findFirst({
    where: { teacherId, validFrom: { lte: fromISODate(monthRange(month).start) } },
    orderBy: [{ validFrom: "desc" }, { createdAt: "desc" }],
  });
}

export async function liveSalary(centerId: string, teacherId: string, month: string): Promise<{ result: SalaryResult; lessons: HeldLesson[] }> {
  const { start, end } = monthRange(month);
  const [center, rule, rows, adjustments] = await Promise.all([
    db.center.findUniqueOrThrow({ where: { id: centerId }, select: { settings: true } }),
    ruleFor(teacherId, month),
    db.lesson.findMany({
      where: { teacherId, status: "HELD", date: { gte: fromISODate(start), lte: fromISODate(end) }, group: { centerId } },
      include: { group: { select: { name: true, code: true } } },
    }),
    db.salaryAdjustment.findMany({ where: { teacherId, month }, orderBy: { createdAt: "asc" } }),
  ]);
  const settings = readSettings(center.settings);
  const asOf = minDate(end, todayISO()) < start ? start : minDate(end, todayISO());
  const inputs = await loadGroupInputs([...new Set(rows.map((r) => r.groupId))], asOf);
  let paidKeys = new Set<string>();
  if (settings.payFromCollected) {
    const families = [...new Set([...inputs.values()].flat().map((x) => x.familyId))];
    const allocs = await allocationsFor(families);
    paidKeys = new Set([...allocs.values()].flatMap((a) => a.units.filter((u) => u.due === 0 && u.charged > 0).map((u) => u.key)));
  }
  const lessons = collectLessons({
    teacherId,
    month,
    lessons: rows.map((r) => ({ id: r.id, date: toISODate(r.date), status: r.status, teacherId: r.teacherId, groupId: r.groupId, groupName: `${r.group.name} #${r.group.code}` })),
    enrollmentsByGroup: inputs,
    payTrial: settings.payTeacherForTrial,
    paidKeys,
  });
  const result = computeSalary({
    rule: rule ? ({ model: rule.model, percent: rule.percent, fixedAmount: rule.fixedAmount, perLesson: rule.perLesson } satisfies SalaryRule) : null,
    lessons,
    adjustments: adjustments.map((a) => ({ id: a.id, amount: a.amount, reason: a.reason })),
    payFromCollected: settings.payFromCollected,
  });
  return { result, lessons };
}

async function assertTeacher(actor: Actor, teacherId: string) {
  const t = await db.user.findFirst({ where: { id: teacherId, centerId: actor.centerId } });
  if (!t) throw new UserError("error.notFound");
  return t;
}

export async function lockPayslip(actor: Actor, teacherId: string, month: string) {
  await assertTeacher(actor, teacherId);
  const { result } = await liveSalary(actor.centerId, teacherId, month);
  await db.$transaction(async (tx) => {
    const existing = await tx.payslip.findUnique({ where: { teacherId_month: { teacherId, month } } });
    if (existing && existing.status !== "DRAFT") throw new UserError("error.locked");
    const data = { status: "LOCKED" as const, total: result.total, lines: result as unknown as Prisma.InputJsonValue, lockedAt: new Date(), lockedById: actor.userId };
    const p = existing ? await tx.payslip.update({ where: { id: existing.id }, data }) : await tx.payslip.create({ data: { ...data, teacherId, month } });
    await audit(tx, { centerId: actor.centerId, userId: actor.userId, entity: "Payslip", entityId: p.id, action: "lock", after: { teacherId, month, total: result.total } });
  });
}

export async function unlockPayslip(actor: Actor, teacherId: string, month: string) {
  await assertTeacher(actor, teacherId);
  await db.$transaction(async (tx) => {
    const p = await tx.payslip.findUnique({ where: { teacherId_month: { teacherId, month } } });
    if (!p || p.status !== "LOCKED") throw new UserError("error.locked");
    await tx.payslip.update({ where: { id: p.id }, data: { status: "DRAFT", lockedAt: null, lockedById: null } });
    await audit(tx, { centerId: actor.centerId, userId: actor.userId, entity: "Payslip", entityId: p.id, action: "unlock", before: { total: p.total } });
  });
}

/** Mark a locked payslip paid and book it as an expense so profit is correct. */
export async function markPayslipPaid(actor: Actor, teacherId: string, month: string) {
  const teacher = await assertTeacher(actor, teacherId);
  await db.$transaction(async (tx) => {
    const p = await tx.payslip.findUnique({ where: { teacherId_month: { teacherId, month } } });
    if (!p || p.status !== "LOCKED") throw new UserError("error.locked");
    const branch = await tx.userBranch.findFirst({ where: { userId: teacherId }, select: { branchId: true } });
    const expense = await tx.expense.create({
      data: {
        centerId: actor.centerId,
        branchId: branch?.branchId ?? null,
        category: SALARY_CATEGORY,
        amount: p.total,
        date: fromISODate(todayISO()),
        note: `${teacher.name} · ${month}`,
        createdById: actor.userId ?? teacherId,
      },
    });
    await tx.payslip.update({ where: { id: p.id }, data: { status: "PAID", paidAt: new Date(), paidById: actor.userId, expenseId: expense.id } });
    await audit(tx, { centerId: actor.centerId, userId: actor.userId, entity: "Payslip", entityId: p.id, action: "paid", after: { total: p.total, expenseId: expense.id } });
  });
}

export async function addAdjustment(actor: Actor, teacherId: string, month: string, amount: number, reason: string) {
  await assertTeacher(actor, teacherId);
  const p = await db.payslip.findUnique({ where: { teacherId_month: { teacherId, month } } });
  if (p && p.status !== "DRAFT") throw new UserError("error.locked");
  await db.$transaction(async (tx) => {
    const a = await tx.salaryAdjustment.create({ data: { teacherId, month, amount, reason, createdById: actor.userId! } });
    await audit(tx, { centerId: actor.centerId, userId: actor.userId, entity: "SalaryAdjustment", entityId: a.id, action: "create", after: a });
  });
}

export async function setSalaryRule(actor: Actor, teacherId: string, rule: SalaryRule & { validFrom: string }) {
  await assertTeacher(actor, teacherId);
  await db.$transaction(async (tx) => {
    const r = await tx.salaryRule.create({
      data: { teacherId, model: rule.model, percent: rule.percent, fixedAmount: rule.fixedAmount, perLesson: rule.perLesson, validFrom: fromISODate(rule.validFrom) },
    });
    await audit(tx, { centerId: actor.centerId, userId: actor.userId, entity: "SalaryRule", entityId: r.id, action: "create", after: r });
  });
}
