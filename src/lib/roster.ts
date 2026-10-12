import { db } from "./db";
import { toISODate } from "./dates";
import { fullName } from "./format";
import { rosterFor } from "./services/attendance";
import type { RosterRow } from "@/components/attendance-form";
import type { TFn } from "./i18n";

/** Roster for a lesson: students whose enrollment covers the date, with any saved attendance. */
export async function lessonRoster(lessonId: string) {
  const lesson = await db.lesson.findUnique({ where: { id: lessonId }, include: { attendance: true } });
  if (!lesson) return [];
  const enrollments = await rosterFor(lesson.groupId, toISODate(lesson.date));
  const saved = new Map(lesson.attendance.map((a) => [a.studentId, a]));
  const rows: RosterRow[] = enrollments.map((e) => {
    const a = saved.get(e.studentId);
    return { studentId: e.studentId, name: fullName(e.student), trial: e.status === "TRIAL" && !e.activatedAt, status: a?.status ?? null, grade: a?.grade ?? null, comment: a?.comment ?? null };
  });
  return rows;
}

export function attendanceLabels(t: TFn) {
  return {
    PRESENT: t("attendance.PRESENT"),
    ABSENT: t("attendance.ABSENT"),
    LATE: t("attendance.LATE"),
    EXCUSED: t("attendance.EXCUSED"),
    grade: t("lessons.grade"),
    comment: t("lessons.comment"),
    save: t("lessons.saveAttendance"),
    allPresent: t("lessons.allPresent"),
    topic: t("lessons.topic"),
    trial: t("enrollment.TRIAL"),
    empty: t("lessons.noStudents"),
    unsaved: t("lessons.unsaved"),
    notMarkedYet: t("lessons.notMarkedYet"),
    gradeComment: t("lessons.gradeComment"),
    savedAll: t("lessons.savedAll"),
  };
}
