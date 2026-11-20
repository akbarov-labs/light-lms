// Homework (pilot): the teacher's answer key per lesson, students' answers from the bot, results for
// the next lesson. Grading is src/lib/homework/grade.ts (code only); this file loads and saves.
//
// The first pilot center's rules (settings.homework): answers close an hour before the next lesson, a
// student who missed it may still answer for a few days (late, shown apart, the teacher is told), the
// student checks the answers up to three times and fixes the wrong ones, and those who have not answered
// are reminded with their parents before the deadline.
import { db, type Tx } from "@/lib/db";
import type { Ctx } from "@/lib/ctx-core";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/user-error";
import { formatDate, formatDateTime, toISODate, type ISODate } from "@/lib/dates";
import { fullName } from "@/lib/format";
import { appUrl } from "@/lib/env";
import { readSettings, type CenterSettings } from "@/lib/settings";
import { chatLocales, enqueue, staffChat, type Chat } from "@/lib/notify";
import { canonical, checkAnswers, homeworkReport, keyKind, lockedQuestions, parseKey, type CheckResult, type HomeworkReport } from "@/lib/homework/grade";
import { homeworkRoute, homeworkWindow, isLate, studentState, windowState, type Window, type WindowRules, type WindowState } from "@/lib/homework/rules";
import { homeworkDueSummary, homeworkLateNotice, homeworkNotice, homeworkReminder } from "@/lib/homework/texts";
import { rosterFor } from "./attendance";
import { lessonFor } from "./lessons";

type LessonRef = { id: string; groupId: string; date: Date; startTime: string; endTime: string };
export type HomeworkSettings = CenterSettings["homework"];

/** The group's next lesson that is not cancelled: where the results are shown and answering closes. */
async function nextLesson(l: LessonRef) {
  return db.lesson.findFirst({
    where: { groupId: l.groupId, status: { not: "CANCELLED" }, id: { not: l.id }, OR: [{ date: { gt: l.date } }, { date: l.date, startTime: { gt: l.startTime } }] },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
    select: { date: true, startTime: true },
  });
}

export async function windowOf(l: LessonRef, rules: WindowRules): Promise<Window> {
  const next = await nextLesson(l);
  return homeworkWindow({ date: toISODate(l.date), endTime: l.endTime }, next ? { date: toISODate(next.date), startTime: next.startTime } : null, rules);
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
  const window = await windowOf(lesson, ctx.settings.homework);
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
export async function recipients(tx: Tx, groupId: string, date: ISODate, directFromGrade: number) {
  const plan = await rosterChats(tx, groupId, date);
  return plan.map((p) => {
    const route = homeworkRoute(p.schoolGrade, directFromGrade);
    const toStudent = route === "student" && p.own.length > 0;
    return { studentId: p.studentId, name: p.name, route: toStudent ? ("student" as const) : ("parents" as const), chats: toStudent ? p.own : p.parents };
  });
}

/** Active students on a lesson's roster with their own linked chat and their parents' chats. */
async function rosterChats(tx: Tx, groupId: string, date: ISODate) {
  const roster = await rosterFor(groupId, date);
  const students = await tx.student.findMany({
    where: { id: { in: roster.map((e) => e.studentId) }, status: "ACTIVE" },
    select: { id: true, firstName: true, lastName: true, schoolGrade: true, telegramChatId: true, familyId: true },
  });
  const guardians = await tx.guardian.findMany({ where: { familyId: { in: students.map((s) => s.familyId) }, telegramChatId: { not: null } }, select: { familyId: true, telegramChatId: true } });
  const plan = students.map((s) => ({
    studentId: s.id,
    name: fullName(s),
    schoolGrade: s.schoolGrade,
    ownIds: s.telegramChatId ? [s.telegramChatId] : [],
    parentIds: [...new Set(guardians.filter((g) => g.familyId === s.familyId).map((g) => g.telegramChatId!))],
  }));
  const locales = await chatLocales(tx, [...new Set(plan.flatMap((p) => [...p.ownIds, ...p.parentIds]))]);
  const chats = (ids: string[]) => ids.map((chatId): Chat => ({ chatId, locale: locales.get(chatId) ?? "uz" }));
  return plan.map((p) => ({ studentId: p.studentId, name: p.name, schoolGrade: p.schoolGrade, own: chats(p.ownIds), parents: chats(p.parentIds) }));
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

type SubRow = { studentId: string; answers: string[]; firstAnswers: string[]; checks: number; firstAnsweredAt: Date | null };

/** What the class report counts: the answers at the first check (retries do not hide mistakes), else the answers as they are. */
const reportAnswers = (s: SubRow) => (s.checks > 0 ? s.firstAnswers : s.answers);

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
  /** on-time answers, first attempts */
  report: HomeworkReport;
  /** correct answers now, for students who fixed answers after checking (only where it differs from the report) */
  improved: Map<string, number>;
  /** answered after the deadline: apart from the class report */
  late: { studentId: string; name: string; correct: number; answered: number }[];
}

async function view(hw: { id: string; lessonId: string; answers: string[]; note: string | null; lesson: LessonRef }, rules: WindowRules, now: Date): Promise<HomeworkView> {
  const date = toISODate(hw.lesson.date);
  const [window, roster, subs] = await Promise.all([
    windowOf(hw.lesson, rules),
    rosterFor(hw.lesson.groupId, date),
    db.homeworkSubmission.findMany({ where: { homeworkId: hw.id }, include: { student: { select: { firstName: true, lastName: true } } } }),
  ]);
  const students = roster.map((e) => ({ studentId: e.studentId, name: fullName(e.student) }));
  for (const s of subs) if (!students.some((x) => x.studentId === s.studentId)) students.push({ studentId: s.studentId, name: fullName(s.student) });
  const onTime = subs.filter((s) => !isLate(window, s.firstAnsweredAt));
  const report = homeworkReport(hw.answers, onTime.map((s) => ({ studentId: s.studentId, answers: reportAnswers(s) })));
  const improved = new Map<string, number>();
  for (const s of onTime) {
    if (s.checks === 0) continue;
    const now = checkAnswers(hw.answers, s.answers).correct;
    if (now !== report.scores.get(s.studentId)?.correct) improved.set(s.studentId, now);
  }
  const late = subs
    .filter((s) => isLate(window, s.firstAnsweredAt) && s.answers.some((a) => a !== ""))
    .map((s) => {
      const r = checkAnswers(hw.answers, s.answers);
      return { studentId: s.studentId, name: fullName(s.student), correct: r.correct, answered: r.total - r.blank.length };
    });
  return { id: hw.id, lessonId: hw.lessonId, lessonDate: date, answers: hw.answers, note: hw.note, window, state: windowState(window, now), students, report, improved, late };
}

const lessonSelect = { select: { id: true, groupId: true, date: true, startTime: true, endTime: true } } as const;

/**
 * For a lesson page: the homework set at this lesson, and the one due at it — the latest homework of
 * an earlier lesson of the group, whose results the teacher goes through now.
 */
export async function lessonHomework(lesson: LessonRef, rules: WindowRules, now = new Date()): Promise<{ set: HomeworkView | null; due: HomeworkView | null }> {
  const [set, due] = await Promise.all([
    db.homework.findUnique({ where: { lessonId: lesson.id }, include: { lesson: lessonSelect } }),
    db.homework.findFirst({
      where: { groupId: lesson.groupId, lesson: { OR: [{ date: { lt: lesson.date } }, { date: lesson.date, startTime: { lt: lesson.startTime } }] } },
      orderBy: [{ lesson: { date: "desc" } }, { lesson: { startTime: "desc" } }],
      include: { lesson: lessonSelect },
    }),
  ]);
  return { set: set ? await view(set, rules, now) : null, due: due ? await view(due, rules, now) : null };
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
  /** answering after the deadline */
  late: boolean;
  /** the result of the last check, when the student has checked */
  checked: { correct: number; checks: number } | null;
}

/** Homework a student can answer right now (their centers have homework on, they were on the lesson's roster). */
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
    const settings = readSettings(hw.center.settings).homework;
    if (hw.center.disabledAt || !settings.enabled) continue;
    const window = await windowOf(hw.lesson, settings);
    if (windowState(window, now) === "notYet" || windowState(window, now) === "closed") continue;
    const date = toISODate(hw.lesson.date);
    for (const e of enrollments.filter((x) => x.groupId === hw.groupId && toISODate(x.startDate) <= date && (!x.endDate || toISODate(x.endDate) >= date))) {
      const s = students.find((x) => x.id === e.studentId)!;
      if (out.some((o) => o.homeworkId === hw.id && o.studentId === s.id)) continue;
      const sub = await db.homeworkSubmission.findUnique({ where: { homeworkId_studentId: { homeworkId: hw.id, studentId: s.id } } });
      const state = studentState(window, now, sub?.firstAnsweredAt ?? null);
      if (state !== "open" && state !== "late") continue;
      out.push({
        homeworkId: hw.id,
        studentId: s.id,
        studentName: fullName(s),
        groupName: hw.group.name,
        lessonDate: date,
        note: hw.note,
        questions: hw.answers.length,
        answered: (sub?.answers ?? []).slice(0, hw.answers.length).filter((a) => a !== "").length,
        dueAt: state === "late" ? window.lateUntil : window.dueAt,
        late: state === "late",
        checked: sub && sub.checks > 0 ? { correct: checkAnswers(hw.answers, sub.checkedAnswers).correct, checks: sub.checks } : null,
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
  /** this student's state: open, late (answering after the deadline), closed */
  state: WindowState;
  /** the deadline this student answers by (the late limit when answering late) */
  dueAt: Date | null;
  /** checks used and allowed (0 allowed = the center has checking off) */
  checks: number;
  attempts: number;
  /** questions right at the last check: fixed, no longer editable */
  locked: number[];
  /** the last check's result (from the answers as they were then) */
  lastCheck: CheckResult | null;
  /** the center lets students send a photo of the notebook */
  photos: boolean;
}

/** Every check used: the sheet can be read, no longer changed. */
export const sheetDone = (s: AnswerSheet) => s.attempts > 0 && s.checks >= s.attempts;
/** Can answers be changed now (open or late, checks left). */
export const sheetEditable = (s: AnswerSheet) => (s.state === "open" || s.state === "late") && !sheetDone(s);

const sheetInclude = { homework: { include: { lesson: lessonSelect, group: { select: { name: true, teacherId: true } }, center: { select: { settings: true } } } } } as const;

async function sheet(submissionId: string, now: Date): Promise<AnswerSheet | null> {
  const sub = await db.homeworkSubmission.findUnique({ where: { id: submissionId }, include: sheetInclude });
  if (!sub) return null;
  const hw = sub.homework;
  const settings = readSettings(hw.center.settings).homework;
  const window = await windowOf(hw.lesson, settings);
  const state = studentState(window, now, sub.firstAnsweredAt);
  return {
    submissionId: sub.id,
    homeworkId: hw.id,
    studentId: sub.studentId,
    groupName: hw.group.name,
    lessonDate: toISODate(hw.lesson.date),
    note: hw.note,
    kinds: hw.answers.map(keyKind),
    letters: hw.answers.some((a) => a.split("|").includes("E")) ? ["A", "B", "C", "D", "E"] : ["A", "B", "C", "D"],
    answers: hw.answers.map((_, i) => sub.answers[i] ?? ""),
    state,
    dueAt: state === "late" ? window.lateUntil : window.dueAt,
    checks: sub.checks,
    attempts: settings.attempts,
    locked: sub.checks > 0 ? [...lockedQuestions(hw.answers, sub.checkedAnswers)] : [],
    lastCheck: sub.checks > 0 ? checkAnswers(hw.answers, sub.checkedAnswers) : null,
    photos: settings.photos,
  };
}

/** Open (or resume) a student's answer sheet; only while the homework is open (or late for this student) and the student was on its roster. */
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

export type AnswerResult = { ok: true; sheet: AnswerSheet } | { ok: false; reason: "closed" | "invalid" | "notFound" | "locked" | "done" };

/** What one typed or read answer becomes: "" clears, else the canonical form when it fits the question's kind. */
function cleanAnswer(raw: string, kind: "choice" | "number"): string | null {
  if (raw.trim() === "") return "";
  const c = canonical(raw);
  if (!c) return null;
  return /^[A-E]$/.test(c) === (kind === "choice") ? c : null;
}

/**
 * Save answers (question index from 0; "" clears). Letters only for choice questions, numbers only for
 * number questions — stored in one form (canonical) and graded from the key. A question right at the
 * last check is locked. Several at once: the answers read from a notebook photo.
 */
export async function saveAnswers(submissionId: string, values: { q: number; raw: string }[], chatId: string, now = new Date()): Promise<AnswerResult & { skipped?: number[] }> {
  const current = await sheet(submissionId, now);
  if (!current || values.some((v) => v.q < 0 || v.q >= current.kinds.length)) return { ok: false, reason: "notFound" };
  if (current.state !== "open" && current.state !== "late") return { ok: false, reason: "closed" };
  if (sheetDone(current)) return { ok: false, reason: "done" };
  const locked = new Set(current.locked);
  const accepted: { q: number; value: string }[] = [];
  const skipped: number[] = [];
  for (const v of values) {
    if (locked.has(v.q)) {
      if (values.length === 1) return { ok: false, reason: "locked" };
      skipped.push(v.q);
      continue;
    }
    const value = cleanAnswer(v.raw, current.kinds[v.q]);
    if (value === null) {
      if (values.length === 1) return { ok: false, reason: "invalid" };
      skipped.push(v.q);
      continue;
    }
    accepted.push({ q: v.q, value });
  }
  await db.$transaction(async (tx) => {
    // one row lock: two quick taps never overwrite each other's answer
    await tx.$queryRaw`SELECT id FROM "HomeworkSubmission" WHERE id = ${submissionId} FOR UPDATE`;
    const row = await tx.homeworkSubmission.findUniqueOrThrow({ where: { id: submissionId }, select: { answers: true, firstAnsweredAt: true } });
    const answers = Array.from({ length: Math.max(row.answers.length, current.kinds.length) }, (_, i) => row.answers[i] ?? "");
    for (const a of accepted) answers[a.q] = a.value;
    const first = !row.firstAnsweredAt && accepted.some((a) => a.value !== "");
    await tx.homeworkSubmission.update({ where: { id: submissionId }, data: { answers, chatId, ...(first ? { firstAnsweredAt: now } : {}) } });
  });
  return { ok: true, sheet: (await sheet(submissionId, now))!, skipped };
}

export async function saveAnswer(submissionId: string, q: number, raw: string, chatId: string, now = new Date()): Promise<AnswerResult> {
  return saveAnswers(submissionId, [{ q, raw }], chatId, now);
}

export type CheckOutcome = { ok: true; sheet: AnswerSheet; result: CheckResult } | { ok: false; reason: "closed" | "notFound" | "done" | "empty" | "off" };

/**
 * The student's "check": grade the answers as they are now, remember them (the first check feeds the
 * class report; the last one locks the right answers), and tell the teacher when this is a late
 * submission's first check.
 */
export async function checkSubmission(submissionId: string, chatId: string, now = new Date()): Promise<CheckOutcome> {
  const current = await sheet(submissionId, now);
  if (!current) return { ok: false, reason: "notFound" };
  if (current.attempts === 0) return { ok: false, reason: "off" };
  if (current.state !== "open" && current.state !== "late") return { ok: false, reason: "closed" };
  if (sheetDone(current)) return { ok: false, reason: "done" };
  if (current.answers.every((a) => a === "")) return { ok: false, reason: "empty" };
  await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "HomeworkSubmission" WHERE id = ${submissionId} FOR UPDATE`;
    const row = await tx.homeworkSubmission.findUniqueOrThrow({ where: { id: submissionId }, include: sheetInclude });
    if (row.checks >= current.attempts) return;
    const answers = current.answers;
    await tx.homeworkSubmission.update({
      where: { id: submissionId },
      data: { checks: { increment: 1 }, checkedAnswers: answers, checkedAt: now, chatId, ...(row.checks === 0 ? { firstAnswers: answers } : {}) },
    });
    if (row.checks > 0 || current.state !== "late") return;
    // late: the teacher and the owners hear about it once, with the score (first pilot: "tell me")
    const hw = row.homework;
    const student = await tx.student.findUniqueOrThrow({ where: { id: row.studentId }, select: { firstName: true, lastName: true } });
    const r = checkAnswers(hw.answers, answers);
    const chats = await teacherChats(tx, hw.centerId, hw.group.teacherId, true);
    await enqueue(
      tx,
      hw.centerId,
      chats,
      (l) => homeworkLateNotice(l, { group: hw.group.name, lessonDate: formatDate(toISODate(hw.lesson.date)), student: fullName(student), correct: r.correct, total: r.total, url: `${appUrl()}/lessons/${hw.lessonId}` }),
      `hwlate:${submissionId}`,
    );
  });
  const after = (await sheet(submissionId, now))!;
  return { ok: true, sheet: after, result: after.lastCheck! };
}

/** The group's teacher in Telegram; when not linked (or `withOwners`), the center's linked owners too. */
export async function teacherChats(tx: Tx, centerId: string, teacherId: string, withOwners = false): Promise<Chat[]> {
  const teacher = await staffChat(tx, teacherId);
  if (teacher && !withOwners) return [teacher];
  const owners = await tx.user.findMany({ where: { centerId, role: "OWNER", archivedAt: null, telegramChatId: { not: null }, id: { not: teacherId } }, select: { id: true } });
  const chats = [teacher, ...(await Promise.all(owners.map((o) => staffChat(tx, o.id))))];
  return chats.filter((c): c is Chat => c !== null);
}

// ------------------------------------------------------------------ the worker: reminders and the deadline

/** How long after the deadline its summary may still go out (a worker down for a while catches up; a new install does not flood). */
const SUMMARY_GRACE_MS = 12 * 3600_000;

/**
 * Every few minutes: before the deadline, those with no answer yet (the student and the parents) are
 * reminded once; at the deadline the teacher gets who answered and who did not, once. Idempotent through
 * the notification dedupe keys.
 */
export async function homeworkJob(now = new Date()): Promise<{ reminded: number; summaries: number }> {
  const centers = await db.center.findMany({ where: { disabledAt: null }, select: { id: true, settings: true } });
  let reminded = 0;
  let summaries = 0;
  for (const c of centers) {
    const s = readSettings(c.settings).homework;
    if (!s.enabled) continue;
    const list = await db.homework.findMany({
      where: { centerId: c.id, lesson: { date: { gte: new Date(now.getTime() - 45 * 86400_000) } } },
      include: { lesson: lessonSelect, group: { select: { name: true, teacherId: true } }, submissions: { select: { studentId: true, answers: true, firstAnswers: true, checks: true, firstAnsweredAt: true } } },
    });
    for (const hw of list) {
      const w = await windowOf(hw.lesson, s);
      if (!w.dueAt || now < w.opensAt) continue;
      const date = toISODate(hw.lesson.date);
      const answered = new Set(hw.submissions.filter((x) => x.answers.some((a) => a !== "")).map((x) => x.studentId));
      if (s.remindHoursBefore > 0 && now < w.dueAt && now.getTime() >= w.dueAt.getTime() - s.remindHoursBefore * 3600_000) {
        const due = formatDateTime(w.dueAt);
        reminded += await db.$transaction(async (tx) => {
          let n = 0;
          for (const p of await rosterChats(tx, hw.groupId, date)) {
            if (answered.has(p.studentId)) continue;
            const chats = [...new Map([...p.own, ...p.parents].map((ch) => [ch.chatId, ch])).values()];
            n += await enqueue(tx, c.id, chats, (l) => homeworkReminder(l, { group: hw.group.name, student: p.name, due, questions: hw.answers.length }), `hwrem:${hw.id}:${p.studentId}`);
          }
          return n;
        });
      }
      if (now >= w.dueAt && now.getTime() < w.dueAt.getTime() + SUMMARY_GRACE_MS) {
        summaries += await db.$transaction(async (tx) => {
          const roster = await rosterChats(tx, hw.groupId, date);
          const onTime = hw.submissions.filter((x) => answered.has(x.studentId) && !isLate(w, x.firstAnsweredAt));
          const scores = onTime.map((x) => checkAnswers(hw.answers, reportAnswers(x)));
          const average = scores.length && hw.answers.length ? Math.round((100 * scores.reduce((a, r) => a + r.correct, 0)) / (scores.length * hw.answers.length)) : null;
          const onTimeIds = new Set(onTime.map((x) => x.studentId));
          const missing = roster.filter((p) => !onTimeIds.has(p.studentId)).map((p) => p.name);
          const chats = await teacherChats(tx, c.id, hw.group.teacherId);
          return enqueue(
            tx,
            c.id,
            chats,
            (l) => homeworkDueSummary(l, { group: hw.group.name, lessonDate: formatDate(date), answered: onTime.length, total: Math.max(roster.length, onTime.length), average, missing, url: `${appUrl()}/lessons/${hw.lessonId}` }),
            `hwdue:${hw.id}`,
          );
        });
      }
    }
  }
  return { reminded, summaries };
}
