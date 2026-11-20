// Make-up lessons: a student who missed a lesson is booked into a make-up on an allowed weekday
// (settings.makeupWeekdays; the first pilot: Sunday only), the family is told, and staff mark whether the
// student came. Billing is untouched: the family already paid for the missed lesson.
import { db } from "@/lib/db";
import { addDays, formatDate, fromISODate, toISODate, todayISO, weekdayOf, type ISODate } from "@/lib/dates";
import { readSettings } from "@/lib/settings";
import { notifyFamily } from "@/lib/notify";
import { esc } from "@/lib/messages";
import { audit } from "@/lib/audit";
import { branchWhere, UserError, type Ctx } from "@/lib/ctx-core";
import type { Locale } from "@/lib/i18n";

/** How far back a missed lesson still shows up as waiting for a make-up. */
export const MISSED_DAYS = 21;

/** The first allowed day on or after `from`. */
export function nextAllowedDay(from: ISODate, weekdays: number[]): ISODate {
  for (let i = 0; i < 7; i++) {
    const d = addDays(from, i);
    if (weekdays.includes(weekdayOf(d))) return d;
  }
  return from;
}

const m = (l: Locale, uz: string, ru: string) => (l === "ru" ? ru : uz);

export function makeupText(l: Locale, p: { center: string; student: string; group: string; missed: ISODate; date: ISODate; time: string }): string {
  return m(
    l,
    `📚 <b>${esc(p.center)}</b>\n${esc(p.student)} ${formatDate(p.missed)} kungi ${esc(p.group)} darsiga kelmadi. Qoldirilgan dars: <b>${formatDate(p.date)}, soat ${p.time}</b>.`,
    `📚 <b>${esc(p.center)}</b>\n${esc(p.student)} пропустил(а) урок ${esc(p.group)} ${formatDate(p.missed)}. Отработка: <b>${formatDate(p.date)}, в ${p.time}</b>.`,
  );
}

/** Absences of the last MISSED_DAYS days with no make-up booked, newest first (the student still studies there). */
export async function missedWithoutMakeup(ctx: Ctx, today: ISODate = todayISO()) {
  const rows = await db.attendance.findMany({
    where: {
      status: "ABSENT",
      lesson: { date: { gte: fromISODate(addDays(today, -MISSED_DAYS)), lte: fromISODate(today) }, group: { centerId: ctx.centerId, ...branchWhere(ctx) } },
      enrollment: { endDate: null },
      student: { status: "ACTIVE" },
    },
    select: { studentId: true, lessonId: true, student: { select: { firstName: true, lastName: true } }, lesson: { select: { date: true, startTime: true, group: { select: { name: true, code: true } } } } },
    orderBy: [{ lesson: { date: "desc" } }],
    take: 500,
  });
  const booked = await db.makeup.findMany({ where: { centerId: ctx.centerId, lessonId: { in: rows.map((r) => r.lessonId) } }, select: { studentId: true, lessonId: true } });
  const has = new Set(booked.map((b) => `${b.studentId}:${b.lessonId}`));
  return rows.filter((r) => !has.has(`${r.studentId}:${r.lessonId}`));
}

/** Book make-ups for the chosen absences on one date and time, and tell each family. */
export async function planMakeups(ctx: Ctx, items: { studentId: string; lessonId: string }[], date: ISODate, time: string, today: ISODate = todayISO()): Promise<number> {
  const s = readSettings((await db.center.findUniqueOrThrow({ where: { id: ctx.centerId }, select: { settings: true } })).settings);
  if (!s.makeupWeekdays.includes(weekdayOf(date))) throw new UserError("makeup.dayNotAllowed");
  if (date < today) throw new UserError("makeup.past");
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) throw new UserError("makeup.badTime");
  let n = 0;
  for (const it of items) {
    // only an absence this staff member may see, of this center
    const a = await db.attendance.findFirst({
      where: { studentId: it.studentId, lessonId: it.lessonId, status: "ABSENT", lesson: { group: { centerId: ctx.centerId, ...branchWhere(ctx) } } },
      select: { student: { select: { firstName: true, lastName: true, familyId: true } }, lesson: { select: { date: true, group: { select: { name: true } } } } },
    });
    if (!a) continue;
    n += await db.$transaction(async (tx) => {
      const made = await tx.makeup.createMany({ data: [{ centerId: ctx.centerId, studentId: it.studentId, lessonId: it.lessonId, date: fromISODate(date), time, createdById: ctx.userId }], skipDuplicates: true });
      if (!made.count) return 0;
      await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Makeup", entityId: `${it.studentId}:${it.lessonId}`, action: "create", after: { date, time } });
      const student = `${a.student.firstName} ${a.student.lastName}`;
      await notifyFamily(tx, {
        centerId: ctx.centerId,
        familyId: a.student.familyId,
        studentId: it.studentId,
        event: "absence",
        text: (l) => makeupText(l, { center: ctx.center.name, student, group: a.lesson.group.name, missed: toISODate(a.lesson.date), date, time }),
        dedupeKey: `makeup:${it.studentId}:${it.lessonId}`,
      });
      return 1;
    });
  }
  return n;
}

export async function setMakeupStatus(ctx: Ctx, id: string, status: "PLANNED" | "DONE" | "MISSED"): Promise<void> {
  const mk = await db.makeup.findFirst({ where: { id, centerId: ctx.centerId, lesson: { group: branchWhere(ctx) } }, select: { id: true, status: true } });
  if (!mk) throw new UserError("error.notFound");
  await db.$transaction(async (tx) => {
    await tx.makeup.update({ where: { id }, data: { status } });
    await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Makeup", entityId: id, action: "update", before: { status: mk.status }, after: { status } });
  });
}

/** Booked make-ups from a week ago on, by date. */
export async function plannedMakeups(ctx: Ctx, today: ISODate = todayISO()) {
  return db.makeup.findMany({
    where: { centerId: ctx.centerId, date: { gte: fromISODate(addDays(today, -7)) }, lesson: { group: branchWhere(ctx) } },
    select: { id: true, date: true, time: true, status: true, student: { select: { id: true, firstName: true, lastName: true } }, lesson: { select: { date: true, group: { select: { name: true, code: true } } } } },
    orderBy: [{ date: "asc" }, { time: "asc" }],
    take: 300,
  });
}
