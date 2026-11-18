// Homework timing and who hears about it (pilot). Pure: the service passes the lessons and settings in.
import type { ISODate } from "../dates";

const at = (date: ISODate, time: string) => {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  // Tashkent wall clock: UTC+5 all year (no DST), the timezone of every center (dates.ts TZ)
  return new Date(Date.UTC(y, mo - 1, d, h, mi) - 5 * 3600_000);
};

export interface Window {
  /** the lesson's end: students can answer from here (a key typed ahead of time waits for it) */
  opensAt: Date;
  /** the group's next lesson start, where the results are shown; null = no next lesson scheduled yet */
  dueAt: Date | null;
}

export function homeworkWindow(lesson: { date: ISODate; endTime: string }, next: { date: ISODate; startTime: string } | null): Window {
  return { opensAt: at(lesson.date, lesson.endTime), dueAt: next ? at(next.date, next.startTime) : null };
}

export type WindowState = "notYet" | "open" | "closed";

export function windowState(w: Window, now: Date): WindowState {
  if (now < w.opensAt) return "notYet";
  if (w.dueAt && now >= w.dueAt) return "closed";
  return "open";
}

/**
 * Who is told about a student's homework: the student from `directFromGrade` up (and when the grade is
 * unknown — adults, graduates), the parents below it. The client's rule: grades 9–11 directly, 4–5 through
 * the parents; 6–8 follows the setting.
 */
export function homeworkRoute(schoolGrade: number | null, directFromGrade: number): "student" | "parents" {
  return schoolGrade === null || schoolGrade >= directFromGrade ? "student" : "parents";
}
