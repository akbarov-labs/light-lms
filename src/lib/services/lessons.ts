// Lesson generation from weekly slots + clash checks. HANDOFF §5 (Groups & schedule, Lessons).
import { db, type Tx } from "@/lib/db";
import { addDays, fromISODate, minDate, toISODate, todayISO, type ISODate } from "@/lib/dates";
import { generateLessonDates } from "@/lib/billing/lessons";
import { findClash, lessonClash, type WeeklySlot } from "@/lib/schedule";
import { readSettings } from "@/lib/settings";
import { UserError } from "@/lib/user-error";
import type { TFn } from "@/lib/i18n";
import type { Ctx } from "@/lib/ctx-core";

/** Staff with groups.edit may touch any lesson in their branches; a teacher only their own. */
export async function lessonFor(ctx: Ctx, lessonId: string, teacherAllowed: boolean) {
  const lesson = await db.lesson.findUnique({ where: { id: lessonId }, include: { group: { select: { centerId: true, branchId: true, teacherId: true } } } });
  if (!lesson || lesson.group.centerId !== ctx.centerId) throw new UserError("error.notFound");
  const isOwnTeacher = ctx.isTeacher && (lesson.teacherId === ctx.userId || lesson.group.teacherId === ctx.userId);
  if (ctx.can("groups.edit") && (!ctx.branchIds || ctx.branchIds.includes(lesson.group.branchId))) return { lesson, asTeacher: false };
  if (teacherAllowed && isOwnTeacher) return { lesson, asTeacher: true };
  throw new UserError("error.forbidden");
}

/** Create missing lessons for a group from its start up to `lessonsAheadDays` ahead. Idempotent. */
export async function generateLessons(groupId: string, opts: { tx?: Tx; today?: ISODate } = {}): Promise<number> {
  const tx = opts.tx ?? db;
  const group = await tx.group.findUnique({ where: { id: groupId }, include: { slots: true, center: { select: { settings: true } } } });
  if (!group || (group.status !== "ACTIVE" && group.status !== "PLANNED")) return 0;
  const settings = readSettings(group.center.settings);
  const today = opts.today ?? todayISO();
  const horizon = addDays(today, settings.lessonsAheadDays);
  const from = toISODate(group.startDate);
  const to = group.endDate ? minDate(toISODate(group.endDate), horizon) : horizon;
  if (from > to) return 0;
  const [holidays, existing] = await Promise.all([
    tx.holiday.findMany({ where: { centerId: group.centerId, date: { gte: fromISODate(from), lte: fromISODate(to) } }, select: { date: true } }),
    tx.lesson.findMany({ where: { groupId }, select: { date: true, startTime: true, origDate: true, origStartTime: true } }),
  ]);
  const taken = new Set<string>();
  for (const l of existing) {
    taken.add(`${toISODate(l.date)}|${l.startTime}`);
    if (l.origDate && l.origStartTime) taken.add(`${toISODate(l.origDate)}|${l.origStartTime}`);
  }
  const planned = generateLessonDates(group.slots, from, to, new Set(holidays.map((h) => toISODate(h.date)))).filter(
    (p) => !taken.has(`${p.date}|${p.startTime}`),
  );
  if (planned.length === 0) return 0;
  const res = await tx.lesson.createMany({
    data: planned.map((p) => ({
      groupId,
      date: fromISODate(p.date),
      startTime: p.startTime,
      endTime: p.endTime,
      teacherId: group.teacherId,
      roomId: group.roomId,
    })),
    skipDuplicates: true,
  });
  return res.count;
}

/**
 * After a schedule/date change: drop future lessons that nothing depends on (still SCHEDULED,
 * no attendance, not moved by hand) and generate again from the new slots.
 */
export async function rebuildFutureLessons(groupId: string, fromDate: ISODate, tx: Tx): Promise<void> {
  await tx.lesson.deleteMany({
    where: { groupId, date: { gte: fromISODate(fromDate) }, status: "SCHEDULED", attendance: { none: {} }, origDate: null },
  });
  await generateLessons(groupId, { tx });
}

/** Remove lessons generated past a new end date (only those nothing depends on). */
export async function trimLessonsAfter(groupId: string, endDate: ISODate, tx: Tx): Promise<void> {
  await tx.lesson.deleteMany({
    where: { groupId, date: { gt: fromISODate(endDate) }, status: "SCHEDULED", attendance: { none: {} } },
  });
}

/** Nightly: lessons for every ACTIVE/PLANNED group. A group that fails is logged and counted; the rest still run. */
export async function generateAllLessons(today = todayISO()): Promise<{ created: number; failed: number }> {
  const groups = await db.group.findMany({ where: { status: { in: ["ACTIVE", "PLANNED"] } }, select: { id: true } });
  let created = 0;
  let failed = 0;
  for (const g of groups) {
    try {
      created += await generateLessons(g.id, { today });
    } catch (e) {
      failed++;
      console.error(`[lessons] group ${g.id}:`, e);
    }
  }
  return { created, failed };
}

/** Throw a readable error when the room or the teacher is already busy in that weekly slot. */
export async function assertNoGroupClash(
  tx: Tx,
  t: TFn,
  p: { centerId: string; groupId?: string; teacherId: string; roomId: string | null; from: ISODate; to: ISODate | null; slots: WeeklySlot[] },
): Promise<void> {
  const others = await tx.group.findMany({
    where: {
      centerId: p.centerId,
      status: { in: ["ACTIVE", "PLANNED"] },
      ...(p.groupId ? { id: { not: p.groupId } } : {}),
      OR: [{ teacherId: p.teacherId }, ...(p.roomId ? [{ roomId: p.roomId }] : [])],
    },
    include: { slots: true, room: { select: { name: true } }, teacher: { select: { name: true } } },
  });
  const asScheduled = (g: (typeof others)[number]) => ({
    from: toISODate(g.startDate),
    to: g.endDate ? toISODate(g.endDate) : null,
    slots: g.slots,
    meta: g,
  });
  const fmt = (c: { otherSlot: WeeklySlot }) => ({ day: t(`common.weekday.${c.otherSlot.weekday}` as "common.weekday.1"), time: `${c.otherSlot.startTime}–${c.otherSlot.endTime}` });
  if (p.roomId) {
    const c = findClash({ from: p.from, to: p.to, slots: p.slots }, others.filter((g) => g.roomId === p.roomId).map(asScheduled));
    if (c) throw new UserError("error.roomClash", { room: c.other.meta.room?.name ?? "", group: `${c.other.meta.name} (#${c.other.meta.code})`, ...fmt(c) });
  }
  const c = findClash({ from: p.from, to: p.to, slots: p.slots }, others.filter((g) => g.teacherId === p.teacherId).map(asScheduled));
  if (c) throw new UserError("error.teacherClash", { teacher: c.other.meta.teacher.name, group: `${c.other.meta.name} (#${c.other.meta.code})`, ...fmt(c) });
}

/** Clash check for one moved/substituted lesson against that day's lessons. */
export async function assertNoLessonClash(
  tx: Tx,
  t: TFn,
  l: { id: string; date: ISODate; startTime: string; endTime: string; teacherId: string; roomId: string | null },
): Promise<void> {
  const sameDay = await tx.lesson.findMany({
    where: { id: { not: l.id }, date: fromISODate(l.date), status: { not: "CANCELLED" }, OR: [{ teacherId: l.teacherId }, ...(l.roomId ? [{ roomId: l.roomId }] : [])] },
    include: { group: { select: { name: true, code: true } }, room: { select: { name: true } }, teacher: { select: { name: true } } },
  });
  const rows = (filter: (x: (typeof sameDay)[number]) => boolean) =>
    sameDay.filter(filter).map((x) => ({ date: toISODate(x.date), startTime: x.startTime, endTime: x.endTime, meta: x }));
  const vars = (x: (typeof sameDay)[number]) => ({ group: `${x.group.name} (#${x.group.code})`, day: l.date, time: `${x.startTime}–${x.endTime}` });
  if (l.roomId) {
    const hit = lessonClash(l, rows((x) => x.roomId === l.roomId));
    if (hit) throw new UserError("error.roomClash", { room: hit.room?.name ?? "", ...vars(hit) });
  }
  const hit = lessonClash(l, rows((x) => x.teacherId === l.teacherId));
  if (hit) throw new UserError("error.teacherClash", { teacher: hit.teacher.name, ...vars(hit) });
  void t;
}
