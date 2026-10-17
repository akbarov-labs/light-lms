import { addDays, weekdayOf, type ISODate } from "@/lib/dates";
import type { BillingEnrollment, BillingLesson, BillingSettings } from "./types";

export interface Slot {
  weekday: number;
  startTime: string;
  endTime: string;
}

export interface PlannedLesson {
  date: ISODate;
  startTime: string;
  endTime: string;
}

/** Lessons a weekly schedule produces in [from, to], skipping holidays. */
export function generateLessonDates(
  slots: Slot[],
  from: ISODate,
  to: ISODate,
  holidays: Set<ISODate>,
): PlannedLesson[] {
  const out: PlannedLesson[] = [];
  if (from > to || slots.length === 0) return out;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (holidays.has(d)) continue;
    const wd = weekdayOf(d);
    for (const s of slots) {
      if (s.weekday === wd) out.push({ date: d, startTime: s.startTime, endTime: s.endTime });
    }
  }
  out.sort((a, b) => (a.date === b.date ? a.startTime.localeCompare(b.startTime) : a.date.localeCompare(b.date)));
  return out;
}

/** Number of slot occurrences in [from, to] (holidays excluded). */
export function countSlotDates(slotWeekdays: number[], from: ISODate, to: ISODate, holidays: Set<ISODate>): number {
  if (from > to || slotWeekdays.length === 0) return 0;
  let n = 0;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (holidays.has(d)) continue;
    const wd = weekdayOf(d);
    for (const w of slotWeekdays) if (w === wd) n++;
  }
  return n;
}

/** Every slot occurrence in [from, to] (holidays excluded), one entry per slot. */
export function slotDates(slotWeekdays: number[], from: ISODate, to: ISODate, holidays: Set<ISODate>): ISODate[] {
  const out: ISODate[] = [];
  if (from > to || slotWeekdays.length === 0) return out;
  for (let d = from; d <= to; d = addDays(d, 1)) {
    if (holidays.has(d)) continue;
    const wd = weekdayOf(d);
    for (const w of slotWeekdays) if (w === wd) out.push(d);
  }
  return out;
}

export function isFrozenOn(enrollment: Pick<BillingEnrollment, "freezes">, date: ISODate): boolean {
  return enrollment.freezes.some((f) => f.from <= date && date <= f.to);
}

/** Does the enrollment's window [startDate, endDate] cover the date (ignoring freezes)? */
export function enrollmentCovers(enrollment: Pick<BillingEnrollment, "startDate" | "endDate">, date: ISODate): boolean {
  return enrollment.startDate <= date && (!enrollment.endDate || date <= enrollment.endDate);
}

/**
 * HANDOFF §7 "chargeable lesson": not cancelled, on/after activation, on/before endDate,
 * not frozen, not an excused absence when the center credits those. Absences are still chargeable.
 */
export function isChargeable(
  lesson: BillingLesson,
  enrollment: BillingEnrollment,
  settings: BillingSettings,
  excusedLessonIds: Set<string>,
): boolean {
  if (lesson.status === "CANCELLED") return false;
  if (lesson.date < enrollment.startDate) return false;
  if (!enrollment.activatedAt || lesson.date < enrollment.activatedAt) return false;
  if (enrollment.endDate && lesson.date > enrollment.endDate) return false;
  if (isFrozenOn(enrollment, lesson.date)) return false;
  if (settings.excusedAbsenceCredit && excusedLessonIds.has(lesson.id)) return false;
  return true;
}
