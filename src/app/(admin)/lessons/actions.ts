"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, type ActionState } from "@/lib/action";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { assertBranch, type Ctx } from "@/lib/ctx";
import { formObject, zDate, zId, zOptStr, zStr, zTime } from "@/lib/forms";
import { UserError } from "@/lib/user-error";
import { fromISODate, toISODate } from "@/lib/dates";
import { saveAttendance, type AttendanceRow, type AttendanceStatus } from "@/lib/services/attendance";
import { assertNoLessonClash } from "@/lib/services/lessons";
import { syncGroup } from "@/lib/billing/sync";

const STATUSES = ["PRESENT", "ABSENT", "LATE", "EXCUSED"] as const;

/** Staff with groups.edit may touch any lesson in their branches; a teacher only their own. */
async function lessonFor(ctx: Ctx, lessonId: string, teacherAllowed: boolean) {
  const lesson = await db.lesson.findUnique({ where: { id: lessonId }, include: { group: { select: { centerId: true, branchId: true, teacherId: true } } } });
  if (!lesson || lesson.group.centerId !== ctx.centerId) throw new UserError("error.notFound");
  const isOwnTeacher = ctx.isTeacher && (lesson.teacherId === ctx.userId || lesson.group.teacherId === ctx.userId);
  if (ctx.can("groups.edit") && (!ctx.branchIds || ctx.branchIds.includes(lesson.group.branchId))) return { lesson, asTeacher: false };
  if (teacherAllowed && isOwnTeacher) return { lesson, asTeacher: true };
  throw new UserError("error.forbidden");
}

function readAttendanceRows(fd: FormData): AttendanceRow[] {
  return fd.getAll("studentId").map((v) => {
    const id = String(v);
    const status = String(fd.get(`status.${id}`) ?? "PRESENT") as AttendanceStatus;
    if (!STATUSES.includes(status)) throw new UserError("error.invalid", { details: "status" });
    const g = String(fd.get(`grade.${id}`) ?? "").trim();
    const comment = String(fd.get(`comment.${id}`) ?? "").trim();
    return { studentId: id, status, grade: g === "" ? null : Number(g), comment: comment || null };
  });
}

export async function saveAttendanceAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(undefined, async (ctx) => {
    const lessonId = zId.parse(fd.get("lessonId"));
    const { lesson, asTeacher } = await lessonFor(ctx, lessonId, true);
    const rows = readAttendanceRows(fd);
    const topic = String(fd.get("topic") ?? "").trim();
    const res = await saveAttendance({ userId: ctx.userId, centerId: ctx.centerId }, lessonId, rows, asTeacher ? { onlyTeacherId: ctx.userId } : {});
    if (topic !== (lesson.topic ?? "")) await db.lesson.update({ where: { id: lessonId }, data: { topic: topic || null } });
    revalidatePath(`/lessons/${lessonId}`);
    revalidatePath(`/t/lessons/${lessonId}`);
    revalidatePath(`/groups/${lesson.groupId}`);
    return { message: res.activated ? `${ctx.t("common.saved")} · ${ctx.t("lessons.trialActivated", { n: res.activated })}` : ctx.t("common.saved") };
  });
}

export async function cancelLessonAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("groups.edit", async (ctx) => {
    const f = z.object({ lessonId: zId, reason: zStr }).parse(formObject(fd));
    const { lesson } = await lessonFor(ctx, f.lessonId, false);
    await db.$transaction(async (tx) => {
      await tx.lesson.update({ where: { id: lesson.id }, data: { status: "CANCELLED", cancelReason: f.reason } });
      await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Lesson", entityId: lesson.id, action: "cancel", before: { status: lesson.status }, after: { status: "CANCELLED", reason: f.reason } });
    });
    await syncGroup(lesson.groupId, { userId: ctx.userId });
    revalidatePath(`/lessons/${lesson.id}`);
  });
}

export async function restoreLessonAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("groups.edit", async (ctx) => {
    const lessonId = zId.parse(fd.get("lessonId"));
    const { lesson } = await lessonFor(ctx, lessonId, false);
    const marked = await db.attendance.count({ where: { lessonId } });
    await db.$transaction(async (tx) => {
      await tx.lesson.update({ where: { id: lessonId }, data: { status: marked > 0 ? "HELD" : "SCHEDULED", cancelReason: null } });
      await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Lesson", entityId: lessonId, action: "restore", before: { status: lesson.status } });
    });
    await syncGroup(lesson.groupId, { userId: ctx.userId });
    revalidatePath(`/lessons/${lessonId}`);
  });
}

export async function rescheduleLessonAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("groups.edit", async (ctx) => {
    const f = z.object({ lessonId: zId, date: zDate, startTime: zTime, endTime: zTime, roomId: zOptStr }).parse(formObject(fd));
    if (f.startTime >= f.endTime) throw new UserError("error.slotTime");
    const { lesson } = await lessonFor(ctx, f.lessonId, false);
    if (lesson.status === "HELD") throw new UserError("error.forbidden");
    const roomId = f.roomId === "-" ? null : (f.roomId ?? lesson.roomId);
    if (roomId) {
      const room = await db.room.findFirst({ where: { id: roomId, branch: { centerId: ctx.centerId } } });
      if (!room) throw new UserError("error.notFound");
      assertBranch(ctx, room.branchId);
    }
    await db.$transaction(async (tx) => {
      await assertNoLessonClash(tx, ctx.t, { id: lesson.id, date: f.date, startTime: f.startTime, endTime: f.endTime, teacherId: lesson.teacherId, roomId });
      const taken = await tx.lesson.findFirst({ where: { groupId: lesson.groupId, date: fromISODate(f.date), startTime: f.startTime, id: { not: lesson.id } } });
      if (taken) throw new UserError("error.teacherClash", { teacher: "", group: "", day: f.date, time: f.startTime });
      await tx.lesson.update({
        where: { id: lesson.id },
        data: {
          date: fromISODate(f.date),
          startTime: f.startTime,
          endTime: f.endTime,
          roomId,
          origDate: lesson.origDate ?? lesson.date,
          origStartTime: lesson.origStartTime ?? lesson.startTime,
        },
      });
      await audit(tx, {
        centerId: ctx.centerId,
        userId: ctx.userId,
        entity: "Lesson",
        entityId: lesson.id,
        action: "reschedule",
        before: { date: toISODate(lesson.date), startTime: lesson.startTime, endTime: lesson.endTime, roomId: lesson.roomId },
        after: { date: f.date, startTime: f.startTime, endTime: f.endTime, roomId },
      });
    });
    await syncGroup(lesson.groupId, { userId: ctx.userId });
    revalidatePath(`/lessons/${lesson.id}`);
  });
}

export async function substituteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("groups.edit", async (ctx) => {
    const f = z.object({ lessonId: zId, teacherId: zId }).parse(formObject(fd));
    const { lesson } = await lessonFor(ctx, f.lessonId, false);
    const teacher = await db.user.findFirst({ where: { id: f.teacherId, centerId: ctx.centerId, archivedAt: null, OR: [{ isTeacher: true }, { role: "TEACHER" }] } });
    if (!teacher) throw new UserError("error.notFound");
    await db.$transaction(async (tx) => {
      await assertNoLessonClash(tx, ctx.t, { id: lesson.id, date: toISODate(lesson.date), startTime: lesson.startTime, endTime: lesson.endTime, teacherId: teacher.id, roomId: null });
      await tx.lesson.update({ where: { id: lesson.id }, data: { teacherId: teacher.id } });
      await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Lesson", entityId: lesson.id, action: "substitute", before: { teacherId: lesson.teacherId }, after: { teacherId: teacher.id } });
    });
    revalidatePath(`/lessons/${lesson.id}`);
  });
}

export async function topicAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(undefined, async (ctx) => {
    const f = z.object({ lessonId: zId, topic: zOptStr }).parse(formObject(fd));
    const { lesson } = await lessonFor(ctx, f.lessonId, true);
    await db.lesson.update({ where: { id: lesson.id }, data: { topic: f.topic ?? null } });
    revalidatePath(`/lessons/${lesson.id}`);
  });
}
