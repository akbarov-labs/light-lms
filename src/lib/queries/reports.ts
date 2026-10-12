// Report queries (HANDOFF §8 "Reports"). Revenue counts only real money (PAYMENT, REFUND and
// their reversals) — never charges or credits.
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { familyScope, scopeBranchIds, studentScope, type Ctx } from "@/lib/ctx-core";
import { diffDays, fromISODate, monthRange, shiftMonth, toISODate, todayISO } from "@/lib/dates";
import { allocationsFor } from "@/lib/services/wallet";
import { paymentWhere } from "./payments";
import { expenseWhere } from "./expenses";

export interface Period {
  from: string;
  to: string;
}

export async function revenue(ctx: Ctx, p: Period) {
  const rows = await db.ledgerEntry.findMany({
    where: paymentWhere(ctx, { from: p.from, to: p.to }),
    select: {
      amount: true,
      method: true,
      type: true,
      student: { select: { branchId: true } },
      family: { select: { students: { select: { branchId: true }, take: 1 } } },
    },
  });
  const byMethod = new Map<string, number>();
  const byBranch = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    total += r.amount;
    const m = r.method ?? "SYSTEM";
    byMethod.set(m, (byMethod.get(m) ?? 0) + r.amount);
    const b = r.student?.branchId ?? r.family.students[0]?.branchId ?? "-";
    byBranch.set(b, (byBranch.get(b) ?? 0) + r.amount);
  }
  return { total, byMethod, byBranch };
}

export async function revenueByMonth(ctx: Ctx, months = 6) {
  const now = todayISO().slice(0, 7);
  const out: { month: string; total: number }[] = [];
  for (let i = months - 1; i >= 0; i--) {
    const m = shiftMonth(now, -i);
    const r = monthRange(m);
    const agg = await db.ledgerEntry.aggregate({ where: paymentWhere(ctx, { from: r.start, to: r.end }), _sum: { amount: true } });
    out.push({ month: m, total: agg._sum.amount ?? 0 });
  }
  return out;
}

export async function expenseTotals(ctx: Ctx, p: Period) {
  const rows = await db.expense.groupBy({ by: ["category", "branchId"], where: expenseWhere(ctx, p), _sum: { amount: true } });
  const byCategory = new Map<string, number>();
  const byBranch = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    const v = r._sum.amount ?? 0;
    total += v;
    byCategory.set(r.category, (byCategory.get(r.category) ?? 0) + v);
    byBranch.set(r.branchId ?? "-", (byBranch.get(r.branchId ?? "-") ?? 0) + v);
  }
  return { total, byCategory, byBranch };
}

/** Tuition billed (charges − credits) per group in the period — shows where revenue is earned. */
export async function billedByGroup(ctx: Ctx, p: Period) {
  const ids = scopeBranchIds(ctx);
  const rows = await db.ledgerEntry.groupBy({
    by: ["enrollmentId"],
    where: {
      centerId: ctx.centerId,
      type: { in: ["CHARGE", "CREDIT"] },
      date: { gte: fromISODate(p.from), lte: fromISODate(p.to) },
      enrollmentId: { not: null },
      ...(ids ? { enrollment: { group: { branchId: { in: ids } } } } : {}),
    },
    _sum: { amount: true },
  });
  const enrollments = await db.enrollment.findMany({
    where: { id: { in: rows.map((r) => r.enrollmentId!) } },
    select: { id: true, group: { select: { id: true, name: true, code: true, course: { select: { name: true } }, teacher: { select: { name: true } } } } },
  });
  const e = new Map(enrollments.map((x) => [x.id, x.group]));
  const byGroup = new Map<string, { name: string; course: string; teacher: string; billed: number }>();
  for (const r of rows) {
    const g = e.get(r.enrollmentId!);
    if (!g) continue;
    const cur = byGroup.get(g.id) ?? { name: `${g.name} #${g.code}`, course: g.course.name, teacher: g.teacher.name, billed: 0 };
    cur.billed += -(r._sum.amount ?? 0);
    byGroup.set(g.id, cur);
  }
  return [...byGroup.values()].sort((a, b) => b.billed - a.billed);
}

/** Total debt and aging buckets by the date each unpaid charge was posted. */
export async function debtAging(ctx: Ctx) {
  const neg = await db.ledgerEntry.groupBy({ by: ["familyId"], where: { centerId: ctx.centerId }, _sum: { amount: true }, having: { amount: { _sum: { lt: 0 } } } });
  let ids = neg.map((n) => n.familyId);
  if (ctx.branchIds || ctx.activeBranchId) {
    const visible = await db.family.findMany({ where: { id: { in: ids }, ...familyScope(ctx) }, select: { id: true } });
    ids = visible.map((v) => v.id);
  }
  const allocs = await allocationsFor(ids);
  const today = todayISO();
  const buckets = [0, 0, 0];
  let total = 0;
  for (const a of allocs.values()) {
    for (const u of a.units) {
      if (u.due <= 0) continue;
      const age = diffDays(today, u.firstDate);
      buckets[age <= 30 ? 0 : age <= 60 ? 1 : 2] += u.due;
      total += u.due;
    }
  }
  return { total, buckets, families: ids.length };
}

export async function studentStats(ctx: Ctx, p: Period) {
  const ids = scopeBranchIds(ctx);
  const groupScope = ids ? { group: { branchId: { in: ids } } } : {};
  const from = fromISODate(p.from);
  const to = fromISODate(p.to);
  const [active, newStudents, left, started] = await Promise.all([
    db.student.count({ where: { centerId: ctx.centerId, status: "ACTIVE", ...studentScope(ctx), enrollments: { some: { endDate: null, status: { in: ["ACTIVE", "FROZEN"] }, ...groupScope } } } }),
    db.student.count({ where: { centerId: ctx.centerId, createdAt: { gte: from, lt: new Date(to.getTime() + 86_400_000) }, ...studentScope(ctx) } }),
    db.enrollment.findMany({ where: { status: "LEFT", endDate: { gte: from, lte: to }, group: { centerId: ctx.centerId, ...(ids ? { branchId: { in: ids } } : {}) } }, select: { leftReason: true } }),
    db.enrollment.findMany({
      where: { startDate: { gte: from, lte: to }, group: { centerId: ctx.centerId, ...(ids ? { branchId: { in: ids } } : {}) }, transferredFrom: { none: {} } },
      select: { startDate: true, activatedAt: true },
    }),
  ]);
  // started as trial = not activated on the first day; converted = activated later
  const trialStarts = started.filter((e) => !e.activatedAt || e.activatedAt > e.startDate);
  const trials = trialStarts.length;
  const trialsActivated = trialStarts.filter((e) => e.activatedAt).length;
  const reasons = new Map<string, number>();
  for (const l of left) reasons.set(l.leftReason ?? "—", (reasons.get(l.leftReason ?? "—") ?? 0) + 1);
  return { active, newStudents, left: left.length, leftReasons: [...reasons.entries()].sort((a, b) => b[1] - a[1]), trials, trialsActivated };
}

export async function leadFunnel(ctx: Ctx, p: Period) {
  const ids = scopeBranchIds(ctx);
  const leads = await db.lead.findMany({
    where: { centerId: ctx.centerId, createdAt: { gte: fromISODate(p.from), lt: new Date(fromISODate(p.to).getTime() + 86_400_000) }, ...(ids ? { OR: [{ branchId: { in: ids } }, { branchId: null }] } : {}) },
    select: { stage: true, source: true, lostReason: true, assignedTo: { select: { name: true } } },
  });
  const count = <K extends string>(f: (l: (typeof leads)[number]) => K) => {
    const m = new Map<K, number>();
    for (const l of leads) m.set(f(l), (m.get(f(l)) ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  };
  const enrolled = leads.filter((l) => l.stage === "ENROLLED").length;
  return {
    total: leads.length,
    byStage: count((l) => l.stage),
    bySource: count((l) => l.source || "—"),
    byAdmin: count((l) => l.assignedTo?.name ?? "—"),
    lostReasons: count((l) => (l.stage === "LOST" ? l.lostReason || "—" : "")).filter(([k]) => k !== ""),
    conversion: leads.length ? Math.round((enrolled / leads.length) * 100) : 0,
  };
}

export async function attendanceStats(ctx: Ctx, p: Period) {
  const ids = scopeBranchIds(ctx);
  const today = todayISO();
  const to = p.to < today ? p.to : today;
  const where = { date: { gte: fromISODate(p.from), lte: fromISODate(to) }, group: { centerId: ctx.centerId, ...(ids ? { branchId: { in: ids } } : {}) } };
  // counted in the database: a big center has tens of thousands of attendance marks a month
  const branchFilter = ids ? Prisma.sql`AND g."branchId" IN (${Prisma.join(ids)})` : Prisma.empty;
  const [rows, missing] = await Promise.all([
    db.$queryRaw<{ group: string; teacher: string; total: number; present: number }[]>`
      SELECT g.name || ' #' || g.code AS "group", u.name AS teacher,
             COUNT(*)::int AS total,
             COUNT(*) FILTER (WHERE a.status IN ('PRESENT', 'LATE'))::int AS present
      FROM "Attendance" a
      JOIN "Lesson" l ON l.id = a."lessonId"
      JOIN "Group" g ON g.id = l."groupId"
      JOIN "User" u ON u.id = l."teacherId"
      WHERE g."centerId" = ${ctx.centerId} AND l.date >= ${p.from}::date AND l.date <= ${to}::date ${branchFilter}
      GROUP BY g.id, g.name, g.code, u.id, u.name`,
    db.lesson.findMany({ where: { ...where, status: "SCHEDULED", date: { gte: fromISODate(p.from), lt: fromISODate(today) } }, include: { group: { select: { name: true, code: true } }, teacher: { select: { name: true } } }, orderBy: { date: "desc" }, take: 200 }),
  ]);
  const agg = (key: (r: (typeof rows)[number]) => string) => {
    const m = new Map<string, { present: number; total: number }>();
    for (const r of rows) {
      const cur = m.get(key(r)) ?? { present: 0, total: 0 };
      cur.total += r.total;
      cur.present += r.present;
      m.set(key(r), cur);
    }
    return [...m.entries()].map(([k, v]) => ({ name: k, rate: v.total ? Math.round((v.present / v.total) * 100) : 0, total: v.total })).sort((a, b) => a.rate - b.rate);
  };
  return {
    byGroup: agg((r) => r.group),
    byTeacher: agg((r) => r.teacher),
    missing: missing.map((l) => ({ id: l.id, date: toISODate(l.date), time: l.startTime, group: `${l.group.name} #${l.group.code}`, teacher: l.teacher.name })),
  };
}
