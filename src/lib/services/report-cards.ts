// Monthly report cards (v2): drafts per enrollment and month, teacher comments, sending to parents.
// Numbers come from computeProgress (src/lib/academics/progress.ts); a sent card keeps its snapshot.
import { randomBytes } from "node:crypto";
import type { Prisma } from "@/generated/prisma/client";
import { db, type Tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { fromISODate, monthRange, shiftMonth, toISODate } from "@/lib/dates";
import { computeProgress, type GradeScale, type Progress } from "@/lib/academics/progress";
import { readSettings } from "@/lib/settings";
import { notifyFamily } from "@/lib/notify";
import { msg } from "@/lib/messages";
import { richMsg } from "@/lib/rich-messages";
import { appUrl } from "@/lib/env";
import { fullName } from "@/lib/format";
import { UserError } from "@/lib/user-error";
import type { Actor } from "./enrollments";

/** What a sent card shows forever (and what a draft shows live). */
export interface ReportCardData {
  v: 1;
  month: string;
  student: string;
  group: string;
  groupCode: number;
  course: string;
  level: string | null;
  teacher: string;
  center: string;
  gradeScale: GradeScale;
  progress: Progress;
  comment: string | null;
  /** exam results of the month (filled once exams exist for the student) */
  exams: { title: string; date: string; score: number; maxScore: number; passed: boolean | null; level: string | null }[];
}

export const newToken = () => randomBytes(18).toString("base64url");

/** Enrollments with a stake in the month: overlapping it and past the free trial. */
export async function monthEnrollments(groupId: string, month: string, tx: Tx = db) {
  const { start, end } = monthRange(month);
  return tx.enrollment.findMany({
    where: {
      groupId,
      startDate: { lte: fromISODate(end) },
      OR: [{ endDate: null }, { endDate: { gte: fromISODate(start) } }],
      NOT: { status: "TRIAL", activatedAt: null },
    },
    include: { student: { select: { id: true, firstName: true, lastName: true, familyId: true } } },
    orderBy: [{ student: { lastName: "asc" } }, { student: { firstName: "asc" } }],
  });
}

async function progressOf(tx: Tx, enrollmentId: string, month: string, withPrev = true): Promise<{ progress: Progress; scale: GradeScale }> {
  const e = await tx.enrollment.findUniqueOrThrow({ where: { id: enrollmentId }, include: { freezes: true, group: { select: { id: true, center: { select: { settings: true } } } } } });
  const { start, end } = monthRange(month);
  const scale = readSettings(e.group.center.settings).gradeScale;
  const lessons = await tx.lesson.findMany({ where: { groupId: e.groupId, date: { gte: fromISODate(start), lte: fromISODate(end) } }, select: { id: true, date: true, status: true, topic: true } });
  const marks = await tx.attendance.findMany({ where: { studentId: e.studentId, lessonId: { in: lessons.map((l) => l.id) } }, select: { lessonId: true, status: true, grade: true, comment: true } });
  const prevAvg = withPrev ? (await progressOf(tx, enrollmentId, shiftMonth(month, -1), false)).progress.gradeAvg : null;
  const progress = computeProgress({
    lessons: lessons.map((l) => ({ id: l.id, date: toISODate(l.date), status: l.status, topic: l.topic })),
    marks,
    window: { start: toISODate(e.startDate), end: e.endDate ? toISODate(e.endDate) : null },
    freezes: e.freezes.map((f) => ({ from: toISODate(f.fromDate), to: toISODate(f.toDate) })),
    gradeScale: scale,
    prevAvg,
  });
  return { progress, scale };
}

/** The card's content: the frozen snapshot of a sent card, else computed now. */
export async function cardData(cardId: string, tx: Tx = db): Promise<ReportCardData> {
  const card = await tx.reportCard.findUniqueOrThrow({
    where: { id: cardId },
    include: { student: true, center: { select: { name: true } }, group: { include: { course: true, teacher: { select: { name: true } } } } },
  });
  if (card.status === "SENT" && card.data) return card.data as unknown as ReportCardData;
  const { progress, scale } = await progressOf(tx, card.enrollmentId, card.month);
  const { start, end } = monthRange(card.month);
  // this group's exams and ungrouped ones (placement, mock) the student sat that month
  const results = await tx.examResult.findMany({
    where: { studentId: card.studentId, exam: { archivedAt: null, date: { gte: fromISODate(start), lte: fromISODate(end) }, OR: [{ groupId: card.groupId }, { groupId: null }] } },
    include: { exam: { select: { title: true, date: true, maxScore: true } } },
    orderBy: { exam: { date: "asc" } },
  });
  return {
    v: 1,
    month: card.month,
    student: fullName(card.student),
    group: card.group.name,
    groupCode: card.group.code,
    course: card.group.course.name,
    level: card.group.course.level,
    teacher: card.group.teacher.name,
    center: card.center.name,
    gradeScale: scale,
    progress,
    comment: card.teacherComment,
    exams: results.map((r) => ({ title: r.exam.title, date: toISODate(r.exam.date), score: r.score, maxScore: r.exam.maxScore, passed: r.passed, level: r.level })),
  };
}

/** Draft rows for every enrollment of the group in the month (existing cards are left alone). */
export async function ensureCards(centerId: string, groupId: string, month: string): Promise<number> {
  const enrollments = await monthEnrollments(groupId, month);
  if (enrollments.length === 0) return 0;
  const res = await db.reportCard.createMany({
    data: enrollments.map((e) => ({ centerId, groupId, studentId: e.studentId, enrollmentId: e.id, month, token: newToken() })),
    skipDuplicates: true,
  });
  return res.count;
}

/** Group teacher, or staff with groups.edit in the group's branch. */
export interface CardAccess {
  userId: string;
  centerId: string;
  canEdit: boolean;
  branchIds: string[] | null;
}

export async function groupForCards(a: CardAccess, groupId: string) {
  const g = await db.group.findFirst({ where: { id: groupId, centerId: a.centerId }, select: { id: true, teacherId: true, branchId: true, name: true, code: true } });
  if (!g) throw new UserError("error.notFound");
  const staff = a.canEdit && (!a.branchIds || a.branchIds.includes(g.branchId));
  if (!staff && g.teacherId !== a.userId) throw new UserError("error.forbidden");
  return g;
}

export async function saveComments(a: CardAccess, groupId: string, month: string, comments: { cardId: string; comment: string | null }[]): Promise<number> {
  await groupForCards(a, groupId);
  let n = 0;
  await db.$transaction(async (tx) => {
    for (const c of comments) {
      const card = await tx.reportCard.findFirst({ where: { id: c.cardId, groupId, month, centerId: a.centerId } });
      if (!card || card.status === "SENT") continue;
      const comment = c.comment?.trim().slice(0, 1000) || null;
      if (comment === card.teacherComment) continue;
      await tx.reportCard.update({ where: { id: card.id }, data: { teacherComment: comment, commentById: a.userId } });
      await audit(tx, { centerId: a.centerId, userId: a.userId, entity: "ReportCard", entityId: card.id, action: "comment", before: { comment: card.teacherComment }, after: { comment } });
      n++;
    }
  });
  return n;
}

export const cardUrl = (token: string) => `${appUrl()}/rc/${token}`;

/**
 * Send drafts to parents: freeze the numbers, mark SENT, queue Telegram (+ SMS when on). Cards whose
 * student had no held lesson that month are skipped (nothing to report). Returns the number sent.
 */
export async function sendCards(actor: Actor, cardIds: string[]): Promise<{ sent: number; skipped: number }> {
  let sent = 0;
  let skipped = 0;
  for (const id of cardIds) {
    const done = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM "ReportCard" WHERE id = ${id} FOR UPDATE`;
      const card = await tx.reportCard.findFirst({ where: { id, centerId: actor.centerId }, include: { student: { select: { familyId: true } }, center: { select: { name: true, settings: true } } } });
      if (!card || card.status === "SENT") return "skip";
      const data = await cardData(card.id, tx);
      if (data.progress.lessons === 0) return "skip";
      await tx.reportCard.update({ where: { id }, data: { status: "SENT", data: data as unknown as Prisma.InputJsonValue, sentAt: new Date(), sentById: actor.userId } });
      await audit(tx, { centerId: actor.centerId, userId: actor.userId, entity: "ReportCard", entityId: id, action: "send", after: { month: card.month, attendancePct: data.progress.attendancePct, gradeAvg: data.progress.gradeAvg } });
      if (readSettings(card.center.settings).notify.reportCard) {
        const notice = { center: card.center.name, student: data.student, group: data.group, month: card.month, attendancePct: data.progress.attendancePct, gradeAvg: data.progress.gradeAvg, url: cardUrl(card.token) };
        await notifyFamily(tx, {
          centerId: actor.centerId,
          familyId: card.student.familyId,
          studentId: card.studentId,
          event: "reportCard",
          text: (l) => msg.reportCard(l, notice),
          rich: (l) => richMsg.reportCard(l, notice),
          dedupeKey: `reportcard:${id}`,
        });
      }
      return "sent";
    }, { timeout: 30_000 });
    if (done === "sent") sent++;
    else skipped++;
  }
  return { sent, skipped };
}

/** Month a report page opens on: last month during the first week (cards are written then), else this month. */
export function defaultReportMonth(today: string): string {
  return Number(today.slice(8, 10)) <= 7 ? shiftMonth(today.slice(0, 7), -1) : today.slice(0, 7);
}

/** Board rows for a group's month: drafts are created on first view, numbers are live until sent. */
export async function boardRows(centerId: string, groupId: string, month: string) {
  await ensureCards(centerId, groupId, month);
  const cards = await db.reportCard.findMany({ where: { groupId, month }, select: { id: true, status: true } });
  const rows = await Promise.all(cards.map(async (c) => ({ id: c.id, status: c.status, data: await cardData(c.id) })));
  return rows.sort((a, b) => a.data.student.localeCompare(b.data.student));
}
