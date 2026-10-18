// Monthly progress of one student in one group — the numbers behind a report card. Pure: the caller
// loads lessons, attendance, the enrollment window and freezes; nothing here touches the database.
import type { ISODate } from "@/lib/dates";

export type GradeScale = "5" | "100";
export type Mark = "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";
export type Rating = "EXCELLENT" | "GOOD" | "FAIR" | "ATTENTION";

export interface ProgressLesson {
  id: string;
  date: ISODate;
  status: "SCHEDULED" | "HELD" | "CANCELLED";
  topic?: string | null;
}

export interface ProgressMark {
  lessonId: string;
  status: Mark;
  grade: number | null;
  comment: string | null;
}

export interface ProgressInput {
  /** lessons of the group in the month */
  lessons: ProgressLesson[];
  /** this student's attendance rows (any lessons; only the month's are used) */
  marks: ProgressMark[];
  /** the enrollment's own dates: lessons outside them are not the student's */
  window: { start: ISODate; end: ISODate | null };
  freezes: { from: ISODate; to: ISODate }[];
  gradeScale: GradeScale;
  /** previous month's average grade, for the trend arrow (null = no grades then) */
  prevAvg?: number | null;
}

export interface ProgressLine {
  date: ISODate;
  status: Mark | null;
  grade: number | null;
  comment: string | null;
  topic: string | null;
}

export interface Progress {
  /** held lessons the student was enrolled for (not frozen) */
  lessons: number;
  present: number;
  late: number;
  absent: number;
  excused: number;
  /** held lessons with no mark for this student (attendance saved before they joined, …) */
  unmarked: number;
  /** (present + late) / marked lessons, whole percent; null when nothing was marked */
  attendancePct: number | null;
  gradeCount: number;
  /** average grade, 1 decimal on the 1–5 scale, whole on 0–100; null without grades */
  gradeAvg: number | null;
  /** average as a share of the scale's maximum, whole percent */
  gradePct: number | null;
  trend: "up" | "down" | "same" | null;
  rating: Rating | null;
  lines: ProgressLine[];
  /** teacher comments written on single lessons this month */
  comments: { date: ISODate; text: string }[];
}

/** Attendance below this share is flagged on the card whatever the grades say. */
export const LOW_ATTENDANCE_PCT = 75;

const round1 = (n: number) => Math.round(n * 10) / 10;

export function ratingFor(gradePct: number | null, attendancePct: number | null): Rating | null {
  if (gradePct === null && attendancePct === null) return null;
  // without grades the rating follows attendance alone; with grades, poor attendance caps it at FAIR
  const base = gradePct ?? attendancePct!;
  let r: Rating = base >= 85 ? "EXCELLENT" : base >= 70 ? "GOOD" : base >= 50 ? "FAIR" : "ATTENTION";
  if (attendancePct !== null && attendancePct < LOW_ATTENDANCE_PCT && (r === "EXCELLENT" || r === "GOOD")) r = "FAIR";
  return r;
}

export function computeProgress(input: ProgressInput): Progress {
  const inWindow = (d: ISODate) => d >= input.window.start && (input.window.end === null || d <= input.window.end);
  const frozen = (d: ISODate) => input.freezes.some((f) => d >= f.from && d <= f.to);
  const byLesson = new Map(input.marks.map((m) => [m.lessonId, m]));
  const lessons = input.lessons
    .filter((l) => l.status === "HELD" && inWindow(l.date) && !frozen(l.date))
    .sort((a, b) => a.date.localeCompare(b.date));
  const p: Progress = { lessons: lessons.length, present: 0, late: 0, absent: 0, excused: 0, unmarked: 0, attendancePct: null, gradeCount: 0, gradeAvg: null, gradePct: null, trend: null, rating: null, lines: [], comments: [] };
  const grades: number[] = [];
  for (const l of lessons) {
    const m = byLesson.get(l.id);
    p.lines.push({ date: l.date, status: m?.status ?? null, grade: m?.grade ?? null, comment: m?.comment ?? null, topic: l.topic ?? null });
    if (!m) {
      p.unmarked++;
      continue;
    }
    if (m.status === "PRESENT") p.present++;
    else if (m.status === "LATE") p.late++;
    else if (m.status === "ABSENT") p.absent++;
    else p.excused++;
    if (m.grade !== null) grades.push(m.grade);
    if (m.comment?.trim()) p.comments.push({ date: l.date, text: m.comment.trim() });
  }
  const marked = p.present + p.late + p.absent + p.excused;
  if (marked > 0) p.attendancePct = Math.round(((p.present + p.late) / marked) * 100);
  if (grades.length > 0) {
    const max = input.gradeScale === "100" ? 100 : 5;
    const avg = grades.reduce((s, g) => s + g, 0) / grades.length;
    p.gradeCount = grades.length;
    p.gradeAvg = input.gradeScale === "100" ? Math.round(avg) : round1(avg);
    p.gradePct = Math.round((avg / max) * 100);
    if (input.prevAvg !== null && input.prevAvg !== undefined) {
      // a move smaller than the shown precision is "same"
      const step = input.gradeScale === "100" ? 1 : 0.1;
      const d = p.gradeAvg - input.prevAvg;
      p.trend = Math.abs(d) < step ? "same" : d > 0 ? "up" : "down";
    }
  }
  p.rating = ratingFor(p.gradePct, p.attendancePct);
  return p;
}
