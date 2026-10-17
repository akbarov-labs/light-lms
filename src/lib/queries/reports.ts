// Report queries (HANDOFF §8 "Reports"). Revenue counts only real money (PAYMENT, REFUND and
// their reversals) — never charges or credits. Sums are done by Postgres (audit P2).
import { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { scopeBranchIds, studentScope, type Ctx } from "@/lib/ctx-core";
import { fromISODate, monthRange, shiftMonth, toISODate, todayISO } from "@/lib/dates";
import { expenseWhere } from "./expenses";
import { debtorFamilies } from "./debtors";
import { agingBuckets } from "@/lib/billing/allocation";
import { parseDues } from "@/lib/billing/balance-cache";
import { familyScopeSql } from "./scope-sql";
import { periodOrThisMonth, zonedRange } from "./period";

export interface Period {
  from: string;
  to: string;
}

/**
 * Money movements of the center in [from, to] (the payments page's rows without filters): PAYMENT,
 * REFUND and reversals of those. Use as
 * `FROM "LedgerEntry" le LEFT JOIN "LedgerEntry" rv ON rv.id = le."reversesId" WHERE <this>`.
 * The family scope is only a cheap superset pre-filter: every row attributed to a scoped branch
 * belongs to a family with a student there. The exact branch filter is in `attributedMoneySql`.
 */
function moneyWhereSql(ctx: Ctx, p: Partial<Period>): Prisma.Sql {
  const { from, to } = periodOrThisMonth(p);
  return Prisma.sql`le."centerId" = ${ctx.centerId}
    AND le.date >= ${from}::date AND le.date <= ${to}::date
    AND (le.type IN ('PAYMENT', 'REFUND') OR (le.type = 'REVERSAL' AND rv.type IN ('PAYMENT', 'REFUND')))
    AND ${familyScopeSql(ctx, 'le."familyId"')}`;
}

/**
 * CTEs ending in `a(method, month, branch, amount)`: money rows of the period, each attributed to one
 * branch (audit B12): the paying student's home branch; for a family-level payment (no student, or a
 * student without a branch) the home branch of the family's student with the most recent open
 * enrollment, ties → earliest created student, then lowest id. No such student → "-". Rows are summed
 * per family first, so the rule runs once per family.
 *
 * In a branch scope (switcher or branch-limited user) only rows attributed to those branches are
 * kept — a sibling family studying in two branches is not counted in full by both, and the branch
 * totals add up to the center total (plus "-").
 */
function attributedMoneySql(ctx: Ctx, p: Partial<Period>): Prisma.Sql {
  const ids = scopeBranchIds(ctx);
  const inScope = !ids ? Prisma.sql`TRUE` : ids.length === 0 ? Prisma.sql`FALSE` : Prisma.sql`a0.branch IN (${Prisma.join(ids)})`;
  return Prisma.sql`m AS (
      SELECT COALESCE(le.method::text, 'SYSTEM') AS method, to_char(le.date, 'YYYY-MM') AS month, s."branchId" AS sb, le."familyId", SUM(le.amount) AS amount
      FROM "LedgerEntry" le
      LEFT JOIN "LedgerEntry" rv ON rv.id = le."reversesId"
      LEFT JOIN "Student" s ON s.id = le."studentId"
      WHERE ${moneyWhereSql(ctx, p)}
      GROUP BY 1, 2, 3, 4
    ), fb AS (
      SELECT DISTINCT ON (fs."familyId" COLLATE "C") fs."familyId", fs."branchId"
      FROM "Student" fs
      LEFT JOIN (
        SELECT oe."studentId", MAX(oe."startDate") AS d
        FROM "Enrollment" oe JOIN "Student" os ON os.id = oe."studentId"
        WHERE oe."endDate" IS NULL AND os."centerId" = ${ctx.centerId}
          AND os."familyId" IN (SELECT "familyId" FROM m WHERE sb IS NULL)
        GROUP BY oe."studentId"
      ) open ON open."studentId" = fs.id
      WHERE fs."centerId" = ${ctx.centerId} AND fs."branchId" IS NOT NULL
        AND fs."familyId" IN (SELECT "familyId" FROM m WHERE sb IS NULL)
      -- byte-order ("C") sorting of the cuid keys: same result, several times faster than the locale collation
      ORDER BY fs."familyId" COLLATE "C", open.d DESC NULLS LAST, fs."createdAt" ASC, fs.id COLLATE "C" ASC
    ), a0 AS (
      SELECT m.method, m.month, COALESCE(m.sb, fb."branchId", '-') AS branch, m.amount
      FROM m LEFT JOIN fb ON m.sb IS NULL AND fb."familyId" = m."familyId"
    ), a AS (
      SELECT * FROM a0 WHERE ${inScope}
    )`;
}

/** Revenue by method and branch (attribution and branch scope: see `attributedMoneySql`). */
export async function revenue(ctx: Ctx, p: Period) {
  const rows = await db.$queryRaw<{ method: string; branch: string; total: bigint }[]>`
    WITH ${attributedMoneySql(ctx, p)}
    SELECT method, branch, SUM(amount)::bigint AS total
    FROM a
    GROUP BY 1, 2
    ORDER BY total DESC, 1, 2`;
  const byMethod = new Map<string, number>();
  const byBranch = new Map<string, number>();
  let total = 0;
  for (const r of rows) {
    const v = Number(r.total);
    total += v;
    byMethod.set(r.method, (byMethod.get(r.method) ?? 0) + v);
    byBranch.set(r.branch, (byBranch.get(r.branch) ?? 0) + v);
  }
  return { total, byMethod, byBranch };
}

/** Money per calendar month for the last `months` months (this month last), in one query. */
export async function revenueByMonth(ctx: Ctx, months = 6) {
  const now = todayISO().slice(0, 7);
  const first = shiftMonth(now, -(months - 1));
  const rows = await db.$queryRaw<{ month: string; total: bigint }[]>`
    WITH ${attributedMoneySql(ctx, { from: monthRange(first).start, to: monthRange(now).end })}
    SELECT month, SUM(amount)::bigint AS total
    FROM a
    GROUP BY 1`;
  const by = new Map(rows.map((r) => [r.month, Number(r.total)]));
  return Array.from({ length: months }, (_, i) => {
    const month = shiftMonth(first, i);
    return { month, total: by.get(month) ?? 0 };
  });
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

/**
 * Total debt and aging buckets by the date each unpaid charge was posted (FIFO allocation, HANDOFF §7).
 * Which families owe is decided in SQL; only their ledgers are read, ALLOC_BATCH families at a time.
 */
/** Debt by age (0–30, 31–60, 60+ days) from the family balance cache: no ledger reads. */
export async function debtAging(ctx: Ctx) {
  const debtors = await debtorFamilies(ctx);
  const today = todayISO();
  const buckets = [0, 0, 0];
  for (const d of debtors) agingBuckets(parseDues(d.dues), today).forEach((x, i) => (buckets[i] += x));
  return { total: debtors.reduce((s, d) => s + d.debt, 0), buckets, families: debtors.length };
}

export async function studentStats(ctx: Ctx, p: Period) {
  const ids = scopeBranchIds(ctx);
  const groupScope = ids ? { group: { branchId: { in: ids } } } : {};
  const from = fromISODate(p.from);
  const to = fromISODate(p.to);
  const [active, newStudents, left, started] = await Promise.all([
    db.student.count({ where: { centerId: ctx.centerId, status: "ACTIVE", ...studentScope(ctx), enrollments: { some: { endDate: null, status: { in: ["ACTIVE", "FROZEN"] }, ...groupScope } } } }),
    // createdAt is a timestamp: whole days in the center timezone, not UTC (audit B13)
    db.student.count({ where: { centerId: ctx.centerId, createdAt: zonedRange(p.from, p.to), ...studentScope(ctx) } }),
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
    where: { centerId: ctx.centerId, createdAt: zonedRange(p.from, p.to), ...(ids ? { OR: [{ branchId: { in: ids } }, { branchId: null }] } : {}) },
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
