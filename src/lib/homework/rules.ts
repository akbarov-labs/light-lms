// Homework timing and who hears about it (pilot). Pure: the service passes the lessons and settings in.
import type { ISODate } from "../dates";

const at = (date: ISODate, time: string) => {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  // Tashkent wall clock: UTC+5 all year (no DST), the timezone of every center (dates.ts TZ)
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - 5 * 3600_000);
};

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

export interface Window {
  /** the lesson's end: students can answer from here (a key typed ahead of time waits for it) */
  opensAt: Date;
  /**
   * The deadline: the group's next lesson start, or `dueMinutesBefore` earlier (the first pilot center: an
   * hour, so the teacher sees the results before class). Null = no next lesson scheduled yet.
   */
  dueAt: Date | null;
  /** the next lesson's start, where the results are shown */
  resultsAt: Date | null;
  /** until when a student who had not answered by the deadline may still answer, marked late; null = no late answers */
  lateUntil: Date | null;
}

export interface WindowRules {
  dueMinutesBefore: number;
  lateDays: number;
}

export function homeworkWindow(lesson: { date: ISODate; endTime: string }, next: { date: ISODate; startTime: string } | null, rules: WindowRules = { dueMinutesBefore: 0, lateDays: 0 }): Window {
  const opensAt = at(lesson.date, lesson.endTime);
  if (!next) return { opensAt, dueAt: null, resultsAt: null, lateUntil: null };
  const resultsAt = at(next.date, next.startTime);
  // never before the lesson the homework was set at has ended
  const dueAt = new Date(Math.max(opensAt.getTime(), resultsAt.getTime() - rules.dueMinutesBefore * MINUTE));
  return { opensAt, dueAt, resultsAt, lateUntil: rules.lateDays > 0 ? new Date(dueAt.getTime() + rules.lateDays * DAY) : null };
}

/** notYet → open → (late, for those who had not answered) → closed */
export type WindowState = "notYet" | "open" | "late" | "closed";

export function windowState(w: Window, now: Date): WindowState {
  if (now < w.opensAt) return "notYet";
  if (!w.dueAt || now < w.dueAt) return "open";
  if (w.lateUntil && now < w.lateUntil) return "late";
  return "closed";
}

/** A submission is late when its first answer came after the deadline. */
export function isLate(w: Window, firstAnsweredAt: Date | null): boolean {
  return !!(w.dueAt && firstAnsweredAt && firstAnsweredAt >= w.dueAt);
}

/**
 * What one student may do now. In the late window only someone who had not answered by the deadline may
 * answer (late); whoever answered on time is done when the deadline passes.
 */
export function studentState(w: Window, now: Date, firstAnsweredAt: Date | null): WindowState {
  const s = windowState(w, now);
  if (s !== "late") return s;
  return firstAnsweredAt && !isLate(w, firstAnsweredAt) ? "closed" : "late";
}

/**
 * Who is told about a student's homework: the student from `directFromGrade` up (and when the grade is
 * unknown — adults, graduates), the parents below it. The client's rule: grades 9–11 directly, 4–5 through
 * the parents; 6–8 follows the setting.
 */
export function homeworkRoute(schoolGrade: number | null, directFromGrade: number): "student" | "parents" {
  return schoolGrade === null || schoolGrade >= directFromGrade ? "student" : "parents";
}
