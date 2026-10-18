// Scheduled jobs (HANDOFF §11). Every job is idempotent and safe to re-run; each logs its counts.
import { db } from "@/lib/db";
import { addDays, diffDays, formatDate, fromISODate, monthRange, parts, todayISO, toISODate, type ISODate } from "@/lib/dates";
import { generateAllLessons } from "@/lib/services/lessons";
import { refreshFreezeStatuses } from "@/lib/services/enrollments";
import { loadBillingInput, syncEnrollment } from "@/lib/billing/sync";
import { computeExpected } from "@/lib/billing/engine";
import { nextPeriodStart, periodContaining } from "@/lib/billing/periods";
import { readSettings } from "@/lib/settings";
import { enqueue, notifyFamily, staffChat } from "@/lib/notify";
import { msg, esc } from "@/lib/messages";
import { balancesFor } from "@/lib/services/wallet";
import { freshBalances, refreshAllBalances } from "@/lib/billing/balance-cache";
import { payLinkForFamily } from "@/lib/payments/links";
import { branchWhere, buildCtx, loadUser, studentScope } from "@/lib/ctx-core";
import { debtAging, revenue } from "@/lib/queries/reports";
import { zonedRange } from "@/lib/queries/period";
import { formatMoney } from "@/lib/money";
import { purgeOldAttempts } from "@/lib/auth/attempts-db";
import { purgeOldNotifications } from "./notifications";
import { errText } from "./util";

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
  // billing touched many families: fill the balance cache now, not on the first page view
  await step("balances", () => refreshAllBalances());
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
    debtNotices += await db.$transaction((tx) =>
      notifyFamily(tx, { centerId, familyId, event: "debt", text: (l) => msg.debt(l, { center: center.name, debt: -balance, payUrl }), dedupeKey: `debt:${familyId}:${today}` }),
    );
  }
  console.log(`[billing] ${enrollments.length} enrollment(s) synced in ${syncMs}ms (${failed} failed), ${debtNotices} debt notice(s)`);
  return { enrollments: enrollments.length, ledgerEntries: entries, syncFailed: failed, debtNotices, billingMs: Date.now() - t0 };
}

/**
 * Run one item of a job (a center, an enrollment, a recipient): a throw is logged and counted, the
 * other items still run. The counts end in "Failed", so jobProblems() raises the ops alert.
 */
async function isolated(label: string, fn: () => Promise<void>, onFail: () => void): Promise<void> {
  try {
    await fn();
  } catch (e) {
    onFail();
    console.error(`[${label}] failed:`, e);
  }
}

/**
 * 10:00 — "new period starts in N days" reminders and escalating debt reminders. Each center and each
 * reminder runs on its own: one broken enrollment or center does not stop the rest.
 */
export async function reminders(today: ISODate = todayISO()): Promise<JobResult> {
  const centers = await db.center.findMany({ select: { id: true, name: true, settings: true } });
  let upcoming = 0;
  let debts = 0;
  let centersFailed = 0;
  let remindersFailed = 0;
  const failItem = () => remindersFailed++;
  for (const c of centers) {
    await isolated(`reminders center ${c.id}`, async () => {
      const s = readSettings(c.settings);
      if (s.notify.reminder && s.reminderDaysBefore > 0) {
        const enrollments = await db.enrollment.findMany({
          where: { endDate: null, status: { in: ["ACTIVE", "FROZEN"] }, group: { centerId: c.id, course: { pricingType: "SUBSCRIPTION" } } },
          include: { group: { include: { course: true } }, student: { select: { id: true, firstName: true, lastName: true, familyId: true } } },
        });
        for (const e of enrollments) {
          await isolated(`reminders enrollment ${e.id}`, async () => {
            const anchor = e.group.course.renewal === "CALENDAR" ? 1 : e.group.course.renewal === "GROUP_START" ? parts(toISODate(e.group.startDate)).d : parts(toISODate(e.activatedAt ?? e.startDate)).d;
            const next = nextPeriodStart(periodContaining(today, anchor).start, anchor);
            if (diffDays(next, today) !== s.reminderDaysBefore) return;
            const { input } = await loadBillingInput(db, e.id, next);
            const unit = computeExpected(input).find((u) => u.start === next);
            if (!unit || unit.amount <= 0) return;
            const payUrl = await payLinkForFamily(e.student.familyId);
            upcoming += await db.$transaction((tx) =>
              notifyFamily(tx, {
                centerId: c.id,
                familyId: e.student.familyId,
                studentId: e.student.id,
                event: "reminder",
                text: (l) => msg.reminder(l, { center: c.name, student: `${e.student.firstName} ${e.student.lastName}`, group: e.group.name, amount: unit.amount, date: next, payUrl }),
                dedupeKey: `remind:${e.id}:${next}`,
              }),
            );
          }, failItem);
        }
      }
      if (s.notify.debt) {
        // debtor families and their oldest unpaid date come from the balance cache, not their ledgers
        await freshBalances(c.id);
        const neg = await db.familyBalance.findMany({ where: { centerId: c.id, balance: { lt: 0 } }, select: { familyId: true, balance: true, oldestUnpaidDate: true } });
        for (const n of neg) {
          await isolated(`reminders debt family ${n.familyId}`, async () => {
            if (!n.oldestUnpaidDate) return;
            const overdue = diffDays(today, toISODate(n.oldestUnpaidDate));
            if (![3, 7, 14, 30].includes(overdue)) return;
            const payUrl = await payLinkForFamily(n.familyId);
            debts += await db.$transaction((tx) =>
              notifyFamily(tx, { centerId: c.id, familyId: n.familyId, event: "debt", text: (l) => msg.debt(l, { center: c.name, debt: -Number(n.balance), payUrl }), dedupeKey: `debt-overdue:${n.familyId}:${today}` }),
            );
          }, failItem);
        }
      }
    }, () => centersFailed++);
  }
  return { upcoming, debts, centersFailed, remindersFailed };
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
  let teachersFailed = 0;
  for (const [teacherId, list] of byTeacher) {
    await isolated(`teacher-reminders ${teacherId}`, async () => {
      sent += await db.$transaction(async (tx) => {
        const chat = await staffChat(tx, teacherId);
        if (!chat) return 0;
        return enqueue(tx, list[0].group.center.id, [chat], (l) => msg.teacherReminder(l, { lessons: list.map((x) => `${x.startTime} ${x.group.name} #${x.group.code}`) }), `teacher:${teacherId}:${today}`);
      });
    }, () => teachersFailed++);
  }
  return { teachers: byTeacher.size, sent, teachersFailed };
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
    // same scope as revenue/debt: a branch-limited manager sees only their branches (as studentStats does)
    db.student.count({ where: { centerId: ctx.centerId, createdAt: zonedRange(today, today), ...studentScope(ctx) } }),
    db.enrollment.count({ where: { status: "LEFT", endDate: fromISODate(today), group: { centerId: ctx.centerId, ...branchWhere(ctx) } } }),
    db.lesson.count({ where: { date: fromISODate(today), status: "SCHEDULED", group: { centerId: ctx.centerId, ...branchWhere(ctx) } } }),
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
  let reportsFailed = 0;
  for (const u of users) {
    await isolated(`daily-report ${u.id}`, async () => {
      if (!readSettings(u.center.settings).notify.dailyReport) return;
      const text = await ownerReport(u.id, today);
      if (!text) return;
      sent += await db.$transaction(async (tx) => {
        const chat = await staffChat(tx, u.id);
        return chat ? enqueue(tx, u.centerId, [chat], () => text, `report:${u.id}:${today}`) : 0;
      });
    }, () => reportsFailed++);
  }
  return { recipients: users.length, sent, reportsFailed };
}
