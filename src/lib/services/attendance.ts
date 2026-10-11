// Attendance — HANDOFF §5 + decision 13: marking attendance makes the lesson HELD.
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { addDays, fromISODate, toISODate, todayISO } from "@/lib/dates";
import { syncEnrollment } from "@/lib/billing/sync";
import { enrollmentCovers, isFrozenOn } from "@/lib/billing/lessons";
import { UserError } from "@/lib/user-error";
import { readSettings } from "@/lib/settings";
import { enqueue, familyChats } from "@/lib/notify";
import { msg } from "@/lib/messages";
import type { Actor } from "./enrollments";

export type AttendanceStatus = "PRESENT" | "ABSENT" | "LATE" | "EXCUSED";

export interface AttendanceRow {
  studentId: string;
  status: AttendanceStatus;
  grade?: number | null;
  comment?: string | null;
}

/** Enrollments of a group that may be marked on this date (window covers it, not frozen). */
export async function rosterFor(groupId: string, date: string) {
  const enrollments = await db.enrollment.findMany({
    where: { groupId, startDate: { lte: fromISODate(date) }, OR: [{ endDate: null }, { endDate: { gte: fromISODate(date) } }] },
    include: { student: { select: { id: true, firstName: true, lastName: true, familyId: true } }, freezes: true },
    orderBy: [{ student: { lastName: "asc" } }, { student: { firstName: "asc" } }],
  });
  return enrollments.filter((e) => !isFrozenOn({ freezes: e.freezes.map((f) => ({ from: toISODate(f.fromDate), to: toISODate(f.toDate) })) }, date));
}

export async function saveAttendance(actor: Actor, lessonId: string, rows: AttendanceRow[], opts: { onlyTeacherId?: string } = {}): Promise<{ activated: number }> {
  return db.$transaction(
    async (tx) => {
      const lesson = await tx.lesson.findUnique({
        where: { id: lessonId },
        include: { group: { include: { center: { select: { id: true, name: true, settings: true } } } }, attendance: true },
      });
      if (!lesson || lesson.group.centerId !== actor.centerId) throw new UserError("error.notFound");
      if (opts.onlyTeacherId && lesson.teacherId !== opts.onlyTeacherId && lesson.group.teacherId !== opts.onlyTeacherId) throw new UserError("error.forbidden");
      if (lesson.status === "CANCELLED") throw new UserError("error.lessonCancelled");
      const date = toISODate(lesson.date);
      if (date > todayISO()) throw new UserError("error.futureLesson");
      const settings = readSettings(lesson.group.center.settings);

      const enrollments = await tx.enrollment.findMany({
        where: { groupId: lesson.groupId, studentId: { in: rows.map((r) => r.studentId) } },
        include: { freezes: true, student: { select: { firstName: true, lastName: true, familyId: true } } },
      });
      const prev = new Map(lesson.attendance.map((a) => [a.studentId, a]));
      const toSync = new Set<string>();
      const activated: string[] = [];
      const maxGrade = settings.gradeScale === "100" ? 100 : 5;

      for (const r of rows) {
        const e = enrollments.find(
          (x) =>
            x.studentId === r.studentId &&
            enrollmentCovers({ startDate: toISODate(x.startDate), endDate: x.endDate ? toISODate(x.endDate) : null }, date) &&
            !isFrozenOn({ freezes: x.freezes.map((f) => ({ from: toISODate(f.fromDate), to: toISODate(f.toDate) })) }, date),
        );
        if (!e) throw new UserError("error.notCovered");
        const grade = r.grade === null || r.grade === undefined ? null : Math.max(0, Math.min(maxGrade, Math.round(r.grade)));
        const before = prev.get(r.studentId);
        await tx.attendance.upsert({
          where: { lessonId_studentId: { lessonId, studentId: r.studentId } },
          create: { lessonId, studentId: r.studentId, enrollmentId: e.id, status: r.status, grade, comment: r.comment ?? null, markedById: actor.userId },
          update: { status: r.status, grade, comment: r.comment ?? null, markedById: actor.userId, enrollmentId: e.id },
        });
        if (settings.excusedAbsenceCredit && (before?.status === "EXCUSED") !== (r.status === "EXCUSED")) toSync.add(e.id);

        // Trial → active after N attended lessons (HANDOFF §6 Trial).
        if (e.status === "TRIAL" && (r.status === "PRESENT" || r.status === "LATE") && settings.trialLessons > 0) {
          const attended = await tx.attendance.count({ where: { enrollmentId: e.id, status: { in: ["PRESENT", "LATE"] } } });
          if (attended >= settings.trialLessons) {
            const next = await tx.lesson.findFirst({
              where: { groupId: lesson.groupId, date: { gt: lesson.date }, status: { not: "CANCELLED" } },
              orderBy: [{ date: "asc" }, { startTime: "asc" }],
              select: { date: true },
            });
            const when = next ? toISODate(next.date) : addDays(date, 1);
            await tx.enrollment.update({ where: { id: e.id }, data: { status: "ACTIVE", activatedAt: fromISODate(when) } });
            await audit(tx, { centerId: actor.centerId, userId: actor.userId, entity: "Enrollment", entityId: e.id, action: "activate.auto", after: { activatedAt: when, afterLessons: attended } });
            activated.push(e.id);
            toSync.add(e.id);
          }
        }

        if (r.status === "ABSENT" && before?.status !== "ABSENT" && date === todayISO() && settings.notify.absence) {
          const chats = await familyChats(tx, e.student.familyId, e.studentId);
          await enqueue(
            tx,
            actor.centerId,
            chats,
            (l) => msg.absent(l, { center: lesson.group.center.name, student: `${e.student.firstName} ${e.student.lastName}`, group: lesson.group.name, date, time: lesson.startTime }),
            `absent:${lessonId}:${r.studentId}`,
          );
        }
      }

      await tx.lesson.update({
        where: { id: lessonId },
        data: { status: "HELD", heldAt: lesson.heldAt ?? new Date(), markedById: actor.userId },
      });
      await audit(tx, {
        centerId: actor.centerId,
        userId: actor.userId,
        entity: "Lesson",
        entityId: lessonId,
        action: "attendance",
        before: lesson.attendance.map((a) => ({ studentId: a.studentId, status: a.status, grade: a.grade })),
        after: rows,
      });
      for (const id of toSync) await syncEnrollment(id, { tx, userId: actor.userId });
      return { activated: activated.length };
    },
    { timeout: 30_000 },
  );
}
