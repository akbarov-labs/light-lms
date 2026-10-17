// Scheduled jobs (HANDOFF §11). Every job is idempotent and safe to re-run; each logs its counts.
import { db } from "@/lib/db";
import { addDays, diffDays, formatDate, fromISODate, monthRange, parts, todayISO, toISODate, type ISODate } from "@/lib/dates";
import { generateAllLessons } from "@/lib/services/lessons";
import { refreshFreezeStatuses } from "@/lib/services/enrollments";
import { loadBillingInput, syncEnrollment } from "@/lib/billing/sync";
import { computeExpected } from "@/lib/billing/engine";
import type { Allocation } from "@/lib/billing/allocation";
import { nextPeriodStart, periodContaining } from "@/lib/billing/periods";
import { readSettings } from "@/lib/settings";
import { enqueue, familyChats, staffChat } from "@/lib/notify";
import { msg, esc } from "@/lib/messages";
import { allocationsFor, balancesFor } from "@/lib/services/wallet";
import { payLinkForFamily } from "@/lib/payments/links";
import { buildCtx, loadUser } from "@/lib/ctx-core";
import { debtAging, revenue } from "@/lib/queries/reports";
import { formatMoney } from "@/lib/money";
import { purgeOldAttempts } from "@/lib/auth/attempts-db";
import { purgeOldNotifications } from "./notifications";

export type JobResult = Record<string, number | string>;

/** Parallel syncs in the nightly billing run. Small on purpose: each one holds a pool connection. */
export const BILLING_CONCURRENCY = 4;

/** Run `fn` over `items` with at most `limit` in flight (no dependency needed for a simple pool). */
export async function forEachLimit<T>(items: readonly T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lane = async () => {
    while (next < items.length) await fn(items[next++]);
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, lane));
}

/** Short error text for a job result: the last line of the message (Prisma puts the cause there). */
const errText = (e: unknown) => {
  const lines = (e instanceof Error ? e.message : String(e)).split("\n").map((l) => l.trim()).filter(Boolean);
  return (lines[lines.length - 1] ?? "error").slice(0, 200);
};

/**
 * 00:30 — lessons ahead, group statuses, freeze statuses, billing for every billable enrollment, housekeeping.
 * Every step runs on its own: one that throws is logged and listed in `failedSteps`, the next ones still run
 * (billing must not be skipped because one group has a broken schedule).
 */
export async function nightly(today: ISODate = todayISO()): Promise<JobResult> {
  const out: JobResult = {};
  const failed: string[] = [];
  const step = async (name: string, fn: () => Promise<JobResult>) => {
    try {
      Object.assign(out, await fn());
    } catch (e) {
      failed.push(name);
      out[`${name}Error`] = errText(e);
      console.error(`[nightly] step ${name} failed:`, e);
    }
  };
  await step("activateGroups", async () => ({
    groupsActivated: (await db.group.updateMany({ where: { status: "PLANNED", startDate: { lte: fromISODate(today) } }, data: { status: "ACTIVE" } })).count,
  }));
  await step("lessons", async () => {
    const r = await generateAllLessons(today);
    return { lessons: r.created, lessonsFailed: r.failed };
  });
  await step("finishGroups", async () => ({
    groupsFinished: (await db.group.updateMany({ where: { status: "ACTIVE", endDate: { lt: fromISODate(today) } }, data: { status: "FINISHED" } })).count,
  }));
  await step("freezes", async () => {
    const r = await refreshFreezeStatuses(today);
    return { freezeStatus: r.changed, freezeFailed: r.failed };
  });
  await step("billing", () => billingSync(today));
  await step("loginAttempts", async () => {
    const p = await purgeOldAttempts();
    return { loginAttemptsPurged: p.attempts, resetCodesPurged: p.resets };
  });
  await step("notificationRetention", async () => {
    const p = await purgeOldNotifications();
    return { sentNotificationsPurged: p.sent, failedNotificationsPurged: p.failed };
  });
  if (failed.length) out.failedSteps = failed.join(",");
  return out;
}

/** What in a job result deserves an ops alert: failed steps or items that could not be processed. */
export function jobProblems(res: JobResult): string | null {
  const parts: string[] = [];
  if (res.failedSteps) parts.push(`failed steps: ${res.failedSteps}`);
  for (const [k, v] of Object.entries(res)) if (/Failed$/.test(k) && typeof v === "number" && v > 0) parts.push(`${k}=${v}`);
  return parts.length ? parts.join("; ") : null;
}

/** Sync every open enrollment (and ones closed in the last 60 days); notify families that fell into debt. */
export async function billingSync(today: ISODate = todayISO()): Promise<JobResult> {
  const t0 = Date.now();
  const enrollments = await db.enrollment.findMany({
    where: { OR: [{ endDate: null }, { endDate: { gte: fromISODate(addDays(today, -60)) } }] },
    select: { id: true, student: { select: { familyId: true, centerId: true } } },
  });
  let entries = 0;
  let failed = 0;
  const charged = new Map<string, string>();
  // each sync is its own transaction with a per-enrollment lock, so running a few at once is safe
  await forEachLimit(enrollments, BILLING_CONCURRENCY, async (e) => {
    try {
      const deltas = await syncEnrollment(e.id, { asOf: today });
      entries += deltas.length;
      if (deltas.some((d) => d.type === "CHARGE")) charged.set(e.student.familyId, e.student.centerId);
    } catch (err) {
      failed++;
      console.error(`[billing] enrollment ${e.id}:`, err);
    }
  });
  const syncMs = Date.now() - t0;
  let debtNotices = 0;
  const centers = new Map<string, { name: string; notifyDebt: boolean } | null>();
  const centerOf = async (id: string) => {
    if (!centers.has(id)) {
      const c = await db.center.findUnique({ where: { id }, select: { name: true, settings: true } });
      centers.set(id, c ? { name: c.name, notifyDebt: readSettings(c.settings).notify.debt } : null);
    }
    return centers.get(id)!;
  };
  const balances = await balancesFor([...charged.keys()]);
  for (const [familyId, centerId] of charged) {
    const center = await centerOf(centerId);
    if (!center?.notifyDebt) continue;
    const balance = balances.get(familyId) ?? 0;
    if (balance >= 0) continue;
    const payUrl = await payLinkForFamily(familyId);
    debtNotices += await db.$transaction(async (tx) => {
      const chats = await familyChats(tx, familyId);
      return enqueue(tx, centerId, chats, (l) => msg.debt(l, { center: center.name, debt: -balance, payUrl }), `debt:${familyId}:${today}`);
    });
  }
  console.log(`[billing] ${enrollments.length} enrollment(s) synced in ${syncMs}ms (${failed} failed), ${debtNotices} debt notice(s)`);
  return { enrollments: enrollments.length, ledgerEntries: entries, syncFailed: failed, debtNotices, billingMs: Date.now() - t0 };
}

const ALLOC_CHUNK = 500;

/** 10:00 — "new period starts in N days" reminders and escalating debt reminders. */
export async function reminders(today: ISODate = todayISO()): Promise<JobResult> {
  const centers = await db.center.findMany({ select: { id: true, name: true, settings: true } });
  let upcoming = 0;
  let debts = 0;
  for (const c of centers) {
    const s = readSettings(c.settings);
    if (s.notify.reminder && s.reminderDaysBefore > 0) {
      const enrollments = await db.enrollment.findMany({
        where: { endDate: null, status: { in: ["ACTIVE", "FROZEN"] }, group: { centerId: c.id, course: { pricingType: "SUBSCRIPTION" } } },
        include: { group: { include: { course: true } }, student: { select: { id: true, firstName: true, lastName: true, familyId: true } } },
      });
      for (const e of enrollments) {
        const anchor = e.group.course.renewal === "CALENDAR" ? 1 : e.group.course.renewal === "GROUP_START" ? parts(toISODate(e.group.startDate)).d : parts(toISODate(e.activatedAt ?? e.startDate)).d;
        const next = nextPeriodStart(periodContaining(today, anchor).start, anchor);
        if (diffDays(next, today) !== s.reminderDaysBefore) continue;
        const { input } = await loadBillingInput(db, e.id, next);
        const unit = computeExpected(input).find((u) => u.start === next);
        if (!unit || unit.amount <= 0) continue;
        const payUrl = await payLinkForFamily(e.student.familyId);
        upcoming += await db.$transaction(async (tx) => {
          const chats = await familyChats(tx, e.student.familyId, e.student.id);
          return enqueue(
            tx,
            c.id,
            chats,
            (l) => msg.reminder(l, { center: c.name, student: `${e.student.firstName} ${e.student.lastName}`, group: e.group.name, amount: unit.amount, date: next, payUrl }),
            `remind:${e.id}:${next}`,
          );
        });
      }
    }
    if (s.notify.debt) {
      const neg = await db.ledgerEntry.groupBy({ by: ["familyId"], where: { centerId: c.id }, _sum: { amount: true }, having: { amount: { _sum: { lt: 0 } } } });
      // ledgers of the debtor families are loaded a chunk at a time, not one query per family
      let allocs = new Map<string, Allocation>();
      for (let i = 0; i < neg.length; i++) {
        if (i % ALLOC_CHUNK === 0) allocs = await allocationsFor(neg.slice(i, i + ALLOC_CHUNK).map((x) => x.familyId));
        const n = neg[i];
        const alloc = allocs.get(n.familyId);
        if (!alloc?.oldestUnpaidDate) continue;
        const overdue = diffDays(today, alloc.oldestUnpaidDate);
        if (![3, 7, 14, 30].includes(overdue)) continue;
        const payUrl = await payLinkForFamily(n.familyId);
        debts += await db.$transaction(async (tx) => {
          const chats = await familyChats(tx, n.familyId);
          return enqueue(tx, c.id, chats, (l) => msg.debt(l, { center: c.name, debt: -(n._sum.amount ?? 0), payUrl }), `debt-overdue:${n.familyId}:${today}`);
        });
      }
    }
  }
  return { upcoming, debts };
}

/** 20:00 — teachers whose lessons today still have no attendance. */
export async function teacherReminders(today: ISODate = todayISO()): Promise<JobResult> {
  const lessons = await db.lesson.findMany({
    where: { date: fromISODate(today), status: "SCHEDULED" },
    include: { group: { select: { name: true, code: true, center: { select: { id: true, settings: true } } } }, teacher: { select: { id: true, telegramChatId: true } } },
    orderBy: { startTime: "asc" },
  });
  const byTeacher = new Map<string, typeof lessons>();
  for (const l of lessons) {
    if (!readSettings(l.group.center.settings).notify.teacherReminder || !l.teacher.telegramChatId) continue;
    const list = byTeacher.get(l.teacherId);
    if (list) list.push(l);
    else byTeacher.set(l.teacherId, [l]);
  }
  let sent = 0;
  for (const [teacherId, list] of byTeacher) {
    sent += await db.$transaction(async (tx) => {
      const chat = await staffChat(tx, teacherId);
      if (!chat) return 0;
      return enqueue(tx, list[0].group.center.id, [chat], (l) => msg.teacherReminder(l, { lessons: list.map((x) => `${x.startTime} ${x.group.name} #${x.group.code}`) }), `teacher:${teacherId}:${today}`);
    });
  }
  return { teachers: byTeacher.size, sent };
}

/** Owner / manager report text (also used by the bot's 📊 button). */
export async function ownerReport(userId: string, today: ISODate = todayISO()): Promise<string | null> {
  const user = await loadUser(userId);
  if (!user || user.archivedAt) return null;
  const ctx = buildCtx(user);
  if (!ctx.can("finance.view")) return null;
  const t = ctx.t;
  const m = monthRange(today.slice(0, 7));
  const [day, month, aging, newStudents, left, missing] = await Promise.all([
    revenue(ctx, { from: today, to: today }),
    revenue(ctx, { from: m.start, to: m.end }),
    debtAging(ctx),
    db.student.count({ where: { centerId: ctx.centerId, createdAt: { gte: fromISODate(today), lt: fromISODate(addDays(today, 1)) } } }),
    db.enrollment.count({ where: { status: "LEFT", endDate: fromISODate(today), group: { centerId: ctx.centerId } } }),
    db.lesson.count({ where: { date: fromISODate(today), status: "SCHEDULED", group: { centerId: ctx.centerId, ...(ctx.branchIds ? { branchId: { in: ctx.branchIds } } : {}) } } }),
  ]);
  const money = (n: number) => formatMoney(n, ctx.locale === "ru" ? "сум" : "so'm");
  return [
    `📊 <b>${esc(ctx.center.name)}</b> · ${formatDate(today)}`,
    `${t("common.today")}: <b>${money(day.total)}</b>`,
    `${t("reports.thisMonth")}: <b>${money(month.total)}</b>`,
    `${t("reports.totalDebt")}: <b>${money(aging.total)}</b>`,
    `${t("reports.new")}: +${newStudents} · ${t("reports.left")}: −${left}`,
    `${t("reports.missing")}: ${missing}`,
  ].join("\n");
}

/** 21:00 — daily report to owners and managers linked in Telegram. */
export async function dailyReport(today: ISODate = todayISO()): Promise<JobResult> {
  const users = await db.user.findMany({ where: { archivedAt: null, telegramChatId: { not: null }, role: { in: ["OWNER", "MANAGER"] } }, include: { center: { select: { settings: true } } } });
  let sent = 0;
  for (const u of users) {
    if (!readSettings(u.center.settings).notify.dailyReport) continue;
    const text = await ownerReport(u.id, today);
    if (!text) continue;
    sent += await db.$transaction(async (tx) => {
      const chat = await staffChat(tx, u.id);
      return chat ? enqueue(tx, u.centerId, [chat], () => text, `report:${u.id}:${today}`) : 0;
    });
  }
  return { recipients: users.length, sent };
}
