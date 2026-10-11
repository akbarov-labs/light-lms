// Scheduled jobs (HANDOFF §11). Every job is idempotent and safe to re-run; each logs its counts.
import { db } from "@/lib/db";
import { addDays, diffDays, formatDate, fromISODate, monthRange, parts, todayISO, toISODate, type ISODate } from "@/lib/dates";
import { generateAllLessons } from "@/lib/services/lessons";
import { refreshFreezeStatuses } from "@/lib/services/enrollments";
import { loadBillingInput, syncEnrollment } from "@/lib/billing/sync";
import { computeExpected } from "@/lib/billing/engine";
import { nextPeriodStart, periodContaining } from "@/lib/billing/periods";
import { readSettings } from "@/lib/settings";
import { enqueue, familyChats, staffChat } from "@/lib/notify";
import { msg, esc } from "@/lib/messages";
import { familyAllocation, familyBalance } from "@/lib/services/wallet";
import { payLinkForFamily } from "@/lib/payments/links";
import { buildCtx, loadUser } from "@/lib/ctx-core";
import { debtAging, revenue } from "@/lib/queries/reports";
import { formatMoney } from "@/lib/money";

export type JobResult = Record<string, number | string>;

/** 00:30 — lessons ahead, group statuses, freeze statuses, billing for every billable enrollment. */
export async function nightly(today: ISODate = todayISO()): Promise<JobResult> {
  const activated = await db.group.updateMany({ where: { status: "PLANNED", startDate: { lte: fromISODate(today) } }, data: { status: "ACTIVE" } });
  const lessons = await generateAllLessons(today);
  const finished = await db.group.updateMany({ where: { status: "ACTIVE", endDate: { lt: fromISODate(today) } }, data: { status: "FINISHED" } });
  const freezes = await refreshFreezeStatuses(today);
  const billing = await billingSync(today);
  return { groupsActivated: activated.count, lessons, groupsFinished: finished.count, freezeStatus: freezes, ...billing };
}

/** Sync every open enrollment (and ones closed in the last 60 days); notify families that fell into debt. */
export async function billingSync(today: ISODate = todayISO()): Promise<JobResult> {
  const enrollments = await db.enrollment.findMany({
    where: { OR: [{ endDate: null }, { endDate: { gte: fromISODate(addDays(today, -60)) } }] },
    select: { id: true, student: { select: { familyId: true, centerId: true } } },
  });
  let entries = 0;
  let failed = 0;
  const charged = new Map<string, string>();
  for (const e of enrollments) {
    try {
      const deltas = await syncEnrollment(e.id, { asOf: today });
      entries += deltas.length;
      if (deltas.some((d) => d.type === "CHARGE")) charged.set(e.student.familyId, e.student.centerId);
    } catch (err) {
      failed++;
      console.error(`[billing] enrollment ${e.id}:`, err);
    }
  }
  let debtNotices = 0;
  for (const [familyId, centerId] of charged) {
    const center = await db.center.findUnique({ where: { id: centerId }, select: { name: true, settings: true } });
    if (!center || !readSettings(center.settings).notify.debt) continue;
    const balance = await familyBalance(familyId);
    if (balance >= 0) continue;
    const payUrl = await payLinkForFamily(familyId);
    debtNotices += await db.$transaction(async (tx) => {
      const chats = await familyChats(tx, familyId);
      return enqueue(tx, centerId, chats, (l) => msg.debt(l, { center: center.name, debt: -balance, payUrl }), `debt:${familyId}:${today}`);
    });
  }
  return { enrollments: enrollments.length, ledgerEntries: entries, syncFailed: failed, debtNotices };
}

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
      for (const n of neg) {
        const alloc = await familyAllocation(n.familyId);
        if (!alloc.oldestUnpaidDate) continue;
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
    byTeacher.set(l.teacherId, [...(byTeacher.get(l.teacherId) ?? []), l]);
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
