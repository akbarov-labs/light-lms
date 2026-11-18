// Homework (pilot): the teacher's answer key per lesson, students' answers from the bot, results for
// the next lesson. Grading is src/lib/homework/grade.ts (code only); this file loads and saves.
import { db, type Tx } from "@/lib/db";
import type { Ctx } from "@/lib/ctx-core";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/user-error";
import { formatDateTime, toISODate, type ISODate } from "@/lib/dates";
import { fullName } from "@/lib/format";
import { readSettings } from "@/lib/settings";
import { chatLocales, enqueue, type Chat } from "@/lib/notify";
import { canonical, homeworkReport, keyKind, parseKey, type HomeworkReport } from "@/lib/homework/grade";
import { homeworkRoute, homeworkWindow, windowState, type Window, type WindowState } from "@/lib/homework/rules";
import { homeworkNotice } from "@/lib/homework/texts";
import { rosterFor } from "./attendance";
import { lessonFor } from "./lessons";

type LessonRef = { id: string; groupId: string; date: Date; startTime: string; endTime: string };

/** The group's next lesson that is not cancelled: where the results are shown and answering closes. */
async function nextLesson(l: LessonRef) {
  return db.lesson.findFirst({
    where: { groupId: l.groupId, status: { not: "CANCELLED" }, id: { not: l.id }, OR: [{ date: { gt: l.date } }, { date: l.date, startTime: { gt: l.startTime } }] },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
    select: { date: true, startTime: true },
  });
}

export async function windowOf(l: LessonRef): Promise<Window> {
  const next = await nextLesson(l);
  return homeworkWindow({ date: toISODate(l.date), endTime: l.endTime }, next ? { date: toISODate(next.date), startTime: next.startTime } : null);
}

// ------------------------------------------------------------------ teacher: the key

export interface SaveHomeworkInput {
  lessonId: string;
  key: string;
  note?: string | null;
}

/** Create or correct the key of a lesson's homework. The first save tells the students (or parents). */
export async function saveHomework(ctx: Ctx, input: SaveHomeworkInput): Promise<{ created: boolean; questions: number; notified: number }> {
  if (!ctx.settings.homework.enabled) throw new UserError("homework.disabled");
  const { lesson } = await lessonFor(ctx, input.lessonId, true);
  if (lesson.status === "CANCELLED") throw new UserError("homework.cancelledLesson");
  const parsed = parseKey(input.key);
  if (!parsed.ok) {
    if (!("index" in parsed)) throw new UserError(parsed.error === "empty" ? "homework.keyEmpty" : "homework.keyTooMany");
    throw new UserError(parsed.error === "numbering" ? "homework.keyNumbering" : parsed.error === "mixed" ? "homework.keyMixed" : "homework.keyBad", { n: parsed.index, token: parsed.token });
  }
  const note = input.note?.trim().slice(0, 500) || null;
  const before = await db.homework.findUnique({ where: { lessonId: lesson.id } });
  const window = await windowOf(lesson);
  return db.$transaction(async (tx) => {
    const hw = before
      ? await tx.homework.update({ where: { id: before.id }, data: { answers: parsed.items, note } })
      : await tx.homework.create({ data: { centerId: ctx.centerId, groupId: lesson.groupId, lessonId: lesson.id, answers: parsed.items, note, createdById: ctx.userId } });
    await audit(tx, {
      centerId: ctx.centerId,
      userId: ctx.userId,
      entity: "Homework",
      entityId: hw.id,
      action: before ? "update" : "create",
      before: before ? { answers: before.answers, note: before.note } : undefined,
      after: { answers: hw.answers, note: hw.note },
    });
    let notified = 0;
    if (!before) {
      const group = await tx.group.findUniqueOrThrow({ where: { id: lesson.groupId }, select: { name: true } });
      const due = window.dueAt ? formatDateTime(window.dueAt) : null;
      for (const r of await recipients(tx, lesson.groupId, toISODate(lesson.date), ctx.settings.homework.directFromGrade)) {
        notified += await enqueue(
          tx,
          ctx.centerId,
          r.chats,
          (l) => homeworkNotice(l, { group: group.name, questions: hw.answers.length, note: hw.note, due, student: r.route === "parents" ? r.name : null }),
          `hw:${hw.id}:${r.studentId}`,
          undefined,
          window.opensAt,
        );
      }
    }
    return { created: !before, questions: hw.answers.length, notified };
  });
}

/**
 * Who hears about the homework, per student on the lesson's roster: the student's own chat from the
 * center's grade threshold up (or when the grade is unknown), the parents below it — and the parents
 * when a student who should hear it directly has no linked chat.
 */
async function recipients(tx: Tx, groupId: string, date: ISODate, directFromGrade: number) {
  const roster = await rosterFor(groupId, date);
  const students = await tx.student.findMany({
    where: { id: { in: roster.map((e) => e.studentId) }, status: "ACTIVE" },
    select: { id: true, firstName: true, lastName: true, schoolGrade: true, telegramChatId: true, familyId: true },
  });
  const guardians = await tx.guardian.findMany({ where: { familyId: { in: students.map((s) => s.familyId) }, telegramChatId: { not: null } }, select: { familyId: true, telegramChatId: true } });
  const plan = students.map((s) => {
    const route = homeworkRoute(s.schoolGrade, directFromGrade);
    const parents = [...new Set(guardians.filter((g) => g.familyId === s.familyId).map((g) => g.telegramChatId!))];
    const own = s.telegramChatId ? [s.telegramChatId] : [];
    const chatIds = route === "student" && own.length ? own : parents;
    return { studentId: s.id, name: fullName(s), route: route === "student" && own.length ? ("student" as const) : ("parents" as const), chatIds };
  });
  const locales = await chatLocales(tx, [...new Set(plan.flatMap((p) => p.chatIds))]);
  return plan.map((p) => ({ ...p, chats: p.chatIds.map((chatId): Chat => ({ chatId, locale: locales.get(chatId) ?? "uz" })) }));
}

export async function deleteHomework(ctx: Ctx, homeworkId: string): Promise<void> {
  const hw = await db.homework.findUnique({ where: { id: homeworkId }, include: { _count: { select: { submissions: true } } } });
  if (!hw || hw.centerId !== ctx.centerId) throw new UserError("error.notFound");
  await lessonFor(ctx, hw.lessonId, true);
  await db.$transaction(async (tx) => {
    await tx.homework.delete({ where: { id: hw.id } });
    // the notice may still be waiting for the lesson's end: a deleted homework is never announced
    await tx.notification.deleteMany({ where: { status: "PENDING", dedupeKey: { startsWith: `hw:${hw.id}:` } } });
    await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Homework", entityId: hw.id, action: "delete", before: { answers: hw.answers, note: hw.note, submissions: hw._count.submissions } });
  });
}

// ------------------------------------------------------------------ results

export interface HomeworkView {
  id: string;
  lessonId: string;
  lessonDate: ISODate;
  answers: string[];
  note: string | null;
  window: Window;
  state: WindowState;
  /** the lesson's roster, plus anyone who answered and has since left */
  students: { studentId: string; name: string }[];
  report: HomeworkReport;
}

async function view(hw: { id: string; lessonId: string; answers: string[]; note: string | null; lesson: LessonRef }, now: Date): Promise<HomeworkView> {
  const date = toISODate(hw.lesson.date);
  const [window, roster, subs] = await Promise.all([
    windowOf(hw.lesson),
    rosterFor(hw.lesson.groupId, date),
    db.homeworkSubmission.findMany({ where: { homeworkId: hw.id }, include: { student: { select: { firstName: true, lastName: true } } } }),
  ]);
  const students = roster.map((e) => ({ studentId: e.studentId, name: fullName(e.student) }));
  for (const s of subs) if (!students.some((x) => x.studentId === s.studentId)) students.push({ studentId: s.studentId, name: fullName(s.student) });
  return {
    id: hw.id,
    lessonId: hw.lessonId,
    lessonDate: date,
    answers: hw.answers,
    note: hw.note,
    window,
    state: windowState(window, now),
    students,
    report: homeworkReport(hw.answers, subs),
  };
}

const lessonSelect = { select: { id: true, groupId: true, date: true, startTime: true, endTime: true } } as const;

/**
 * For a lesson page: the homework set at this lesson, and the one due at it — the latest homework of
 * an earlier lesson of the group, whose results the teacher goes through now.
 */
export async function lessonHomework(lesson: LessonRef, now = new Date()): Promise<{ set: HomeworkView | null; due: HomeworkView | null }> {
  const [set, due] = await Promise.all([
    db.homework.findUnique({ where: { lessonId: lesson.id }, include: { lesson: lessonSelect } }),
    db.homework.findFirst({
      where: { groupId: lesson.groupId, lesson: { OR: [{ date: { lt: lesson.date } }, { date: lesson.date, startTime: { lt: lesson.startTime } }] } },
      orderBy: [{ lesson: { date: "desc" } }, { lesson: { startTime: "desc" } }],
      include: { lesson: lessonSelect },
    }),
  ]);
  return { set: set ? await view(set, now) : null, due: due ? await view(due, now) : null };
}

// ------------------------------------------------------------------ students: answering (bot)

export interface OpenHomework {
  homeworkId: string;
  studentId: string;
  studentName: string;
  groupName: string;
  lessonDate: ISODate;
  note: string | null;
  questions: number;
  answered: number;
  dueAt: Date | null;
}

/** Homework open right now for these students (their centers have homework on, they were on the lesson's roster). */
export async function openHomeworkFor(students: { id: string; firstName: string; lastName: string }[], now = new Date()): Promise<OpenHomework[]> {
  if (students.length === 0) return [];
  const enrollments = await db.enrollment.findMany({
    where: { studentId: { in: students.map((s) => s.id) } },
    select: { studentId: true, groupId: true, startDate: true, endDate: true },
  });
  const groupIds = [...new Set(enrollments.map((e) => e.groupId))];
  const recent = await db.homework.findMany({
    // older homework is closed by now: every group meets at least once a month
    where: { groupId: { in: groupIds }, lesson: { date: { gte: new Date(now.getTime() - 45 * 86400_000) } } },
    include: { lesson: lessonSelect, group: { select: { name: true } }, center: { select: { settings: true, disabledAt: true } } },
  });
  const out: OpenHomework[] = [];
  for (const hw of recent) {
    if (hw.center.disabledAt || !readSettings(hw.center.settings).homework.enabled) continue;
    const window = await windowOf(hw.lesson);
    if (windowState(window, now) !== "open") continue;
    const date = toISODate(hw.lesson.date);
    for (const e of enrollments.filter((x) => x.groupId === hw.groupId && toISODate(x.startDate) <= date && (!x.endDate || toISODate(x.endDate) >= date))) {
      const s = students.find((x) => x.id === e.studentId)!;
      if (out.some((o) => o.homeworkId === hw.id && o.studentId === s.id)) continue;
      const sub = await db.homeworkSubmission.findUnique({ where: { homeworkId_studentId: { homeworkId: hw.id, studentId: s.id } }, select: { answers: true } });
      out.push({
        homeworkId: hw.id,
        studentId: s.id,
        studentName: fullName(s),
        groupName: hw.group.name,
        lessonDate: date,
        note: hw.note,
        questions: hw.answers.length,
        answered: (sub?.answers ?? []).slice(0, hw.answers.length).filter((a) => a !== "").length,
        dueAt: window.dueAt,
      });
    }
  }
  return out.sort((a, b) => a.lessonDate.localeCompare(b.lessonDate) || a.studentName.localeCompare(b.studentName));
}

export interface AnswerSheet {
  submissionId: string;
  homeworkId: string;
  studentId: string;
  groupName: string;
  lessonDate: ISODate;
  note: string | null;
  /** the kind of each question from the key: letters to tap or a number to type; never the key itself */
  kinds: ("choice" | "number")[];
  /** A–D, or A–E when any answer of this homework is E */
  letters: string[];
  answers: string[];
  state: WindowState;
  dueAt: Date | null;
}

async function sheet(submissionId: string, now: Date): Promise<AnswerSheet | null> {
  const sub = await db.homeworkSubmission.findUnique({ where: { id: submissionId }, include: { homework: { include: { lesson: lessonSelect, group: { select: { name: true } } } } } });
  if (!sub) return null;
  const hw = sub.homework;
  const window = await windowOf(hw.lesson);
  const kinds = hw.answers.map(keyKind);
  return {
    submissionId: sub.id,
    homeworkId: hw.id,
    studentId: sub.studentId,
    groupName: hw.group.name,
    lessonDate: toISODate(hw.lesson.date),
    note: hw.note,
    kinds,
    letters: hw.answers.some((a) => a.split("|").includes("E")) ? ["A", "B", "C", "D", "E"] : ["A", "B", "C", "D"],
    answers: hw.answers.map((_, i) => sub.answers[i] ?? ""),
    state: windowState(window, now),
    dueAt: window.dueAt,
  };
}

/** Open (or resume) a student's answer sheet; only while the homework is open and the student was on its roster. */
export async function startAnswering(homeworkId: string, studentId: string, chatId: string, now = new Date()): Promise<AnswerSheet | "closed" | null> {
  const open = await db.student.findUnique({ where: { id: studentId }, select: { id: true, firstName: true, lastName: true } });
  if (!open) return null;
  const list = await openHomeworkFor([open], now);
  if (!list.some((h) => h.homeworkId === homeworkId)) {
    const exists = await db.homework.findUnique({ where: { id: homeworkId }, select: { id: true } });
    return exists ? "closed" : null;
  }
  const sub = await db.homeworkSubmission.upsert({
    where: { homeworkId_studentId: { homeworkId, studentId } },
    create: { homeworkId, studentId, answers: [], chatId },
    update: {},
  });
  return sheet(sub.id, now);
}

export async function answerSheet(submissionId: string, now = new Date()): Promise<AnswerSheet | null> {
  return sheet(submissionId, now);
}

export type AnswerResult = { ok: true; sheet: AnswerSheet } | { ok: false; reason: "closed" | "invalid" | "notFound" };

/**
 * Save one answer (question index from 0; "" clears it). Letters only for choice questions, numbers only
 * for number questions — what was typed is stored in one form (canonical) and graded later from the key.
 */
export async function saveAnswer(submissionId: string, q: number, raw: string, chatId: string, now = new Date()): Promise<AnswerResult> {
  const current = await sheet(submissionId, now);
  if (!current || q < 0 || q >= current.kinds.length) return { ok: false, reason: "notFound" };
  if (current.state !== "open") return { ok: false, reason: "closed" };
  let value = "";
  if (raw.trim() !== "") {
    const c = canonical(raw);
    if (!c) return { ok: false, reason: "invalid" };
    const isLetter = /^[A-E]$/.test(c);
    if (isLetter !== (current.kinds[q] === "choice")) return { ok: false, reason: "invalid" };
    value = c;
  }
  await db.$transaction(async (tx) => {
    // one row lock: two quick taps never overwrite each other's answer
    await tx.$queryRaw`SELECT id FROM "HomeworkSubmission" WHERE id = ${submissionId} FOR UPDATE`;
    const row = await tx.homeworkSubmission.findUniqueOrThrow({ where: { id: submissionId }, select: { answers: true } });
    const answers = Array.from({ length: Math.max(row.answers.length, current.kinds.length) }, (_, i) => row.answers[i] ?? "");
    answers[q] = value;
    await tx.homeworkSubmission.update({ where: { id: submissionId }, data: { answers, chatId } });
  });
  return { ok: true, sheet: (await sheet(submissionId, now))! };
}
