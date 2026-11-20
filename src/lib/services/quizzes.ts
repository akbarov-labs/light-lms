// Timed tests taken in the Telegram Mini App (pilot): daily/monthly topic tests for a group, and the center's
// placement test for newcomers. Questions come only from the center's bank, approved by a person; code grades
// every answer (src/lib/quizzes/grade.ts), never a model; the clock runs from the moment a student opens the
// test (src/lib/quizzes/timing.ts). The first pilot center's rules: results reach the owner (and the teacher)
// at once, the student sees their own score and which numbers were wrong, parents only when the owner sends
// them; a placement result is a suggestion, and only the owner enrolls.
import { db, type Tx } from "@/lib/db";
import { canAccessBranch, type Ctx } from "@/lib/ctx-core";
import { audit } from "@/lib/audit";
import { UserError } from "@/lib/user-error";
import { appUrl } from "@/lib/env";
import { fullName } from "@/lib/format";
import { todayISO, fromISODate } from "@/lib/dates";
import { normalizePhone } from "@/lib/phone";
import { validLinks } from "@/lib/telegram-links";
import { chatLocales, enqueue, staffChat, type Chat } from "@/lib/notify";
import { compareCodes } from "@/lib/questions/keys";
import { pickPlacement, pickReplacement, pickTopicQuestions, type PoolQuestion } from "@/lib/quizzes/select";
import { cleanQuizAnswer, gradeAttempt, passed, percentOf, type QuizGrade } from "@/lib/quizzes/grade";
import { attemptState, deadlineOf, MAX_MINUTES, minutesUsed, MIN_MINUTES, secondsLeft, type AttemptState } from "@/lib/quizzes/timing";
import { reachableTopics, suggestGroup } from "@/lib/quizzes/placement";
import { placementResultStaff, quizNotice, quizResultParent, quizResultStaff, QUIZ_BTN } from "@/lib/quizzes/texts";
import { bankOverview } from "./questions";
import { recipients, teacherChats } from "./homework";
import { createStudentWithFamily } from "./students";
import { enrollStudent, nextLessonDate } from "./enrollments";

export const MAX_QUESTIONS = 50;
export const PLACEMENT_COUNT = { min: 5, max: 40, default: 20 } as const;
/** A placement with fewer questions than this in the person's range says nothing: refused. */
export const PLACEMENT_MIN_DRAWN = 5;

// ------------------------------------------------------------------ the bank

/** Approved questions with a key and no picture (the Mini App shows text only), of a topic and the ones under it, or of the whole bank. */
async function approvedPool(centerId: string, topicCode?: string): Promise<PoolQuestion[]> {
  const rows = await db.question.findMany({
    where: { centerId, status: "APPROVED", needsFigure: false, answer: { not: "" }, ...(topicCode ? { topic: { OR: [{ code: topicCode }, { code: { startsWith: `${topicCode}.` } }] } } : {}) },
    select: { id: true, number: true, topic: { select: { code: true } } },
  });
  return rows.map((r) => ({ id: r.id, number: r.number, topicCode: r.topic.code }));
}

/** Questions by id, in the given order (a question deleted since stays as an empty one, never right). */
async function questionsInOrder(ids: string[]) {
  const rows = await db.question.findMany({ where: { id: { in: ids } }, select: { id: true, text: true, options: true, answer: true, number: true, status: true, topic: { select: { code: true, title: true } } } });
  const byId = new Map(rows.map((r) => [r.id, r]));
  return ids.map((id) => byId.get(id) ?? { id, text: "—", options: [] as string[], answer: "", number: null, status: "REJECTED" as const, topic: { code: "", title: "" } });
}

const checkMinutes = (m: number) => {
  if (!Number.isInteger(m) || m < MIN_MINUTES || m > MAX_MINUTES) throw new UserError("quizzes.badMinutes", { max: MAX_MINUTES });
};

// ------------------------------------------------------------------ staff: topic tests

export interface NewTopicQuiz {
  groupId: string;
  topicId: string;
  count: number;
  minutes: number;
  title?: string | null;
}

/** A draft topic test for a group: `count` approved questions of the topic (and its sub-topics) drawn at random. */
export async function createTopicQuiz(ctx: Ctx, input: NewTopicQuiz): Promise<string> {
  const [group, topic] = await Promise.all([
    db.group.findFirst({ where: { id: input.groupId, centerId: ctx.centerId } }),
    db.questionTopic.findFirst({ where: { id: input.topicId, centerId: ctx.centerId } }),
  ]);
  if (!group || !canAccessBranch(ctx, group.branchId) || !topic) throw new UserError("error.notFound");
  checkMinutes(input.minutes);
  if (!Number.isInteger(input.count) || input.count < 1 || input.count > MAX_QUESTIONS) throw new UserError("quizzes.badCount", { max: MAX_QUESTIONS });
  const pool = await approvedPool(ctx.centerId, topic.code);
  if (pool.length === 0) throw new UserError("quizzes.noQuestions");
  // the same group, topic and day draw the same set: a test made twice by mistake is the same test
  const picked = pickTopicQuestions(pool, input.count, `${group.id}:${topic.id}:${todayISO()}`);
  const title = input.title?.trim().slice(0, 200) || `${topic.code}. ${topic.title}`;
  return db.$transaction(async (tx) => {
    const quiz = await tx.quiz.create({
      data: { centerId: ctx.centerId, kind: "TOPIC", title, groupId: group.id, topicId: topic.id, minutes: input.minutes, questionIds: picked.map((q) => q.id), createdById: ctx.userId },
    });
    await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Quiz", entityId: quiz.id, action: "create", after: { title, groupId: group.id, topicId: topic.id, minutes: quiz.minutes, questions: picked.length } });
    return quiz.id;
  });
}

async function ownQuiz(ctx: Ctx, id: string) {
  const quiz = await db.quiz.findFirst({ where: { id, centerId: ctx.centerId }, include: { group: { select: { id: true, name: true, branchId: true, teacherId: true } }, topic: { select: { code: true, title: true } } } });
  if (!quiz || (quiz.group && !canAccessBranch(ctx, quiz.group.branchId))) throw new UserError("error.notFound");
  return quiz;
}

async function draftQuiz(ctx: Ctx, id: string) {
  const quiz = await ownQuiz(ctx, id);
  if (quiz.kind !== "TOPIC" || quiz.status !== "DRAFT") throw new UserError("quizzes.notDraft");
  return quiz;
}

export async function removeQuizQuestion(ctx: Ctx, quizId: string, questionId: string): Promise<void> {
  const quiz = await draftQuiz(ctx, quizId);
  if (!quiz.questionIds.includes(questionId)) throw new UserError("error.notFound");
  if (quiz.questionIds.length <= 1) throw new UserError("quizzes.lastQuestion");
  await db.quiz.update({ where: { id: quiz.id }, data: { questionIds: quiz.questionIds.filter((x) => x !== questionId) } });
}

/** Put another approved question of the same topic in place of one (same position). */
export async function replaceQuizQuestion(ctx: Ctx, quizId: string, questionId: string): Promise<void> {
  const quiz = await draftQuiz(ctx, quizId);
  const at = quiz.questionIds.indexOf(questionId);
  if (at === -1) throw new UserError("error.notFound");
  const pool = await approvedPool(ctx.centerId, quiz.topic?.code);
  const next = pickReplacement(pool, new Set(quiz.questionIds), `${quiz.id}:${quiz.questionIds.join(",")}`);
  if (!next) throw new UserError("quizzes.noReplacement");
  const ids = [...quiz.questionIds];
  ids[at] = next.id;
  await db.quiz.update({ where: { id: quiz.id }, data: { questionIds: ids } });
}

export async function updateQuizDraft(ctx: Ctx, quizId: string, input: { title: string; minutes: number }): Promise<void> {
  const quiz = await draftQuiz(ctx, quizId);
  checkMinutes(input.minutes);
  const title = input.title.trim().slice(0, 200);
  if (!title) throw new UserError("quizzes.emptyTitle");
  await db.quiz.update({ where: { id: quiz.id }, data: { title, minutes: input.minutes } });
}

export async function deleteQuizDraft(ctx: Ctx, quizId: string): Promise<void> {
  const quiz = await draftQuiz(ctx, quizId);
  await db.$transaction(async (tx) => {
    await tx.quiz.delete({ where: { id: quiz.id } });
    await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Quiz", entityId: quiz.id, action: "delete", before: { title: quiz.title, questions: quiz.questionIds.length } });
  });
}

/**
 * Open the test: the group's students (or their parents below the homework grade threshold) get a message
 * with a button that opens it in the Mini App. Every question must still be approved.
 */
export async function publishQuiz(ctx: Ctx, quizId: string): Promise<{ notified: number }> {
  const quiz = await draftQuiz(ctx, quizId);
  const approved = await db.question.count({ where: { id: { in: quiz.questionIds }, centerId: ctx.centerId, status: "APPROVED", answer: { not: "" } } });
  if (approved !== quiz.questionIds.length) throw new UserError("quizzes.notApproved", { n: quiz.questionIds.length - approved });
  const group = quiz.group!;
  return db.$transaction(async (tx) => {
    const res = await tx.quiz.updateMany({ where: { id: quiz.id, status: "DRAFT" }, data: { status: "PUBLISHED", publishedAt: new Date() } });
    if (res.count === 0) throw new UserError("quizzes.notDraft");
    await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Quiz", entityId: quiz.id, action: "publish", after: { questions: quiz.questionIds.length, minutes: quiz.minutes } });
    let notified = 0;
    for (const r of await recipients(tx, group.id, todayISO(), ctx.settings.homework.directFromGrade)) {
      notified += await enqueue(
        tx,
        ctx.centerId,
        r.chats,
        (l) => quizNotice(l, { title: quiz.title, group: group.name, questions: quiz.questionIds.length, minutes: quiz.minutes, student: r.route === "parents" ? r.name : null }),
        `quiz:${quiz.id}:${r.studentId}`,
        undefined,
        undefined,
        { text: (l) => QUIZ_BTN[l], path: `/tg/quiz?q=${quiz.id}` },
      );
    }
    return { notified };
  });
}

/** No new attempts; running ones are finished now with what they have. */
export async function closeQuiz(ctx: Ctx, quizId: string, now = new Date()): Promise<void> {
  const quiz = await ownQuiz(ctx, quizId);
  if (quiz.kind !== "TOPIC" || quiz.status !== "PUBLISHED") throw new UserError("quizzes.notPublished");
  await db.$transaction(async (tx) => {
    await tx.quiz.update({ where: { id: quiz.id }, data: { status: "CLOSED", closedAt: now } });
    await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Quiz", entityId: quiz.id, action: "close" });
  });
  const open = await db.quizAttempt.findMany({ where: { quizId: quiz.id, submittedAt: null }, select: { id: true, deadlineAt: true } });
  for (const a of open) await finishAttempt(a.id, a.deadlineAt < now ? a.deadlineAt : now, true);
}

/**
 * The owner's permission for parents to see the results ("ota-ona ko'rmoqchi bo'lsa mendan ruxsat olsin"):
 * each finished student's score goes to the parents' chats. Pressing again later sends only the new ones.
 * Owners and managers only.
 */
export async function sendResultsToParents(ctx: Ctx, quizId: string, now = new Date()): Promise<{ sent: number; students: number }> {
  if (ctx.role !== "OWNER" && ctx.role !== "MANAGER") throw new UserError("quizzes.ownerOnly");
  const quiz = await ownQuiz(ctx, quizId);
  if (quiz.kind !== "TOPIC" || quiz.status === "DRAFT") throw new UserError("quizzes.notPublished");
  await finishExpired({ quizId: quiz.id }, now);
  const attempts = await db.quizAttempt.findMany({ where: { quizId: quiz.id, submittedAt: { not: null }, studentId: { not: null } }, include: { student: { select: { firstName: true, lastName: true, familyId: true } } } });
  const questions = await questionsInOrder(quiz.questionIds);
  return db.$transaction(async (tx) => {
    let sent = 0;
    let students = 0;
    for (const a of attempts) {
      const s = a.student!;
      const g = gradeAttempt(questions, a.answers);
      const guardians = await tx.guardian.findMany({ where: { familyId: s.familyId, telegramChatId: { not: null } }, select: { telegramChatId: true } });
      const ids = [...new Set(guardians.map((x) => x.telegramChatId!))];
      if (ids.length === 0) continue;
      const locales = await chatLocales(tx, ids);
      const n = await enqueue(
        tx,
        ctx.centerId,
        ids.map((chatId): Chat => ({ chatId, locale: locales.get(chatId) ?? "uz" })),
        (l) => quizResultParent(l, { student: fullName(s), title: quiz.title, group: quiz.group?.name ?? "", correct: g.correct, total: g.total, percent: percentOf(g.correct, g.total) }),
        `quizpar:${a.id}`,
      );
      sent += n;
      if (n > 0) students++;
    }
    await tx.quiz.update({ where: { id: quiz.id }, data: { parentsSentAt: now } });
    await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Quiz", entityId: quiz.id, action: "parents.send", after: { messages: sent, students } });
    return { sent, students };
  });
}

/** The owner marks the topic a group is at now (used for topic tests and placement suggestions); null clears it. */
export async function setGroupTopic(ctx: Ctx, groupId: string, topicId: string | null): Promise<void> {
  const group = await db.group.findFirst({ where: { id: groupId, centerId: ctx.centerId } });
  if (!group || !canAccessBranch(ctx, group.branchId)) throw new UserError("error.notFound");
  if (topicId && !(await db.questionTopic.findFirst({ where: { id: topicId, centerId: ctx.centerId }, select: { id: true } }))) throw new UserError("error.notFound");
  await db.$transaction(async (tx) => {
    await tx.group.update({ where: { id: group.id }, data: { currentTopicId: topicId } });
    await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Group", entityId: group.id, action: "topic", before: { topicId: group.currentTopicId }, after: { topicId } });
  });
}

// ------------------------------------------------------------------ staff: reading

export async function quizList(ctx: Ctx) {
  const quizzes = await db.quiz.findMany({
    where: { centerId: ctx.centerId, kind: "TOPIC", ...(ctx.branchIds ? { group: { branchId: { in: ctx.branchIds } } } : {}) },
    include: { group: { select: { name: true } }, _count: { select: { attempts: { where: { submittedAt: { not: null } } } } } },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return quizzes.map((q) => ({ id: q.id, title: q.title, group: q.group?.name ?? "", status: q.status, questions: q.questionIds.length, minutes: q.minutes, finished: q._count.attempts, createdAt: q.createdAt, publishedAt: q.publishedAt }));
}

export interface ResultRow {
  studentId: string;
  name: string;
  state: AttemptState | "notStarted";
  correct: number | null;
  total: number;
  percent: number | null;
  minutes: number | null;
  wrong: number[];
  auto: boolean;
  submittedAt: Date | null;
}

/** A quiz with its questions (and keys: staff only) and one row per student of the group, best first. */
export async function quizDetail(ctx: Ctx, quizId: string, now = new Date()) {
  const quiz = await ownQuiz(ctx, quizId);
  if (quiz.kind !== "TOPIC") throw new UserError("error.notFound");
  await finishExpired({ quizId: quiz.id }, now);
  const [questions, attempts] = await Promise.all([
    questionsInOrder(quiz.questionIds),
    db.quizAttempt.findMany({ where: { quizId: quiz.id }, include: { student: { select: { id: true, firstName: true, lastName: true } } } }),
  ]);
  const roster = quiz.group ? await db.enrollment.findMany({ where: { groupId: quiz.group.id, OR: [{ endDate: null }, { endDate: { gte: fromISODate(todayISO(now)) } }] }, include: { student: { select: { id: true, firstName: true, lastName: true } } } }) : [];
  const rows = new Map<string, ResultRow>();
  for (const e of roster) rows.set(e.student.id, { studentId: e.student.id, name: fullName(e.student), state: "notStarted", correct: null, total: questions.length, percent: null, minutes: null, wrong: [], auto: false, submittedAt: null });
  for (const a of attempts) {
    if (!a.student) continue;
    const state = attemptState(a, now);
    // graded on read from the current keys: a key corrected after the test re-grades everyone (as homework)
    const g: QuizGrade | null = state === "submitted" ? gradeAttempt(questions, a.answers) : null;
    rows.set(a.student.id, {
      studentId: a.student.id,
      name: fullName(a.student),
      state,
      correct: g?.correct ?? null,
      total: questions.length,
      percent: g ? percentOf(g.correct, g.total) : null,
      minutes: minutesUsed(a),
      wrong: g?.wrong ?? [],
      auto: a.autoSubmitted,
      submittedAt: a.submittedAt,
    });
  }
  const order = { submitted: 0, open: 1, expired: 1, notStarted: 2 } as const;
  const results = [...rows.values()].sort((a, b) => order[a.state] - order[b.state] || (b.correct ?? -1) - (a.correct ?? -1) || a.name.localeCompare(b.name));
  // how many got each question wrong: the class's weak spots
  const wrongCount = questions.map((_, i) => results.filter((r) => r.state === "submitted" && r.wrong.includes(i + 1)).length);
  return { quiz, questions, results, wrongCount };
}

// ------------------------------------------------------------------ finishing (submit, deadline, worker)

const attemptInclude = {
  quiz: { include: { group: { select: { id: true, name: true, teacherId: true } } } },
  student: { select: { firstName: true, lastName: true, phone: true } },
  lead: { select: { name: true, phone: true } },
  topic: { select: { code: true, title: true } },
} as const;

/** The center's linked owners in Telegram. */
async function ownerChats(tx: Tx, centerId: string): Promise<Chat[]> {
  const owners = await tx.user.findMany({ where: { centerId, role: "OWNER", archivedAt: null, telegramChatId: { not: null } }, select: { id: true } });
  return (await Promise.all(owners.map((o) => staffChat(tx, o.id)))).filter((c): c is Chat => c !== null);
}

/** Groups with a current topic, for placement suggestions. */
async function groupsAt(centerId: string, branchIds: string[] | null = null) {
  const groups = await db.group.findMany({
    where: { centerId, status: { in: ["ACTIVE", "PLANNED"] }, ...(branchIds ? { branchId: { in: branchIds } } : {}) },
    select: { id: true, name: true, code: true, currentTopic: { select: { code: true, title: true } } },
    orderBy: { code: "asc" },
  });
  return groups.map((g) => ({ id: g.id, name: g.name, code: g.code, topicCode: g.currentTopic?.code ?? null, topicTitle: g.currentTopic?.title ?? null }));
}

/**
 * Grade and close an attempt (the student pressed "finish", or the time ran out), and tell the owners (and
 * the group's teacher for a topic test) at once. Idempotent: only the first call does anything.
 */
async function finishAttempt(attemptId: string, at: Date, auto: boolean): Promise<QuizGrade | null> {
  const a = await db.quizAttempt.findUnique({ where: { id: attemptId }, include: attemptInclude });
  if (!a || a.submittedAt) return null;
  const questions = await questionsInOrder(a.questionIds);
  const g = gradeAttempt(questions, a.answers);
  const percent = percentOf(g.correct, g.total);
  const centerId = a.quiz.centerId;
  const placement = a.quiz.kind === "PLACEMENT";
  const suggestion = placement && a.topic ? await suggestionFor(centerId, a.topic.code, passed(g.correct, g.total, a.quiz.passPercent)) : null;
  return db.$transaction(async (tx) => {
    const res = await tx.quizAttempt.updateMany({ where: { id: a.id, submittedAt: null }, data: { submittedAt: at, autoSubmitted: auto, correct: g.correct, total: g.total } });
    if (res.count === 0) return null;
    const minutes = minutesUsed({ ...a, submittedAt: at });
    if (placement) {
      await enqueue(
        tx,
        centerId,
        await ownerChats(tx, centerId),
        (l) =>
          placementResultStaff(l, {
            name: attemptName(a),
            phone: a.lead?.phone ?? a.student?.phone ?? null,
            topic: a.topic ? `${a.topic.code}. ${a.topic.title}` : "—",
            correct: g.correct,
            total: g.total,
            percent,
            passed: passed(g.correct, g.total, a.quiz.passPercent),
            suggestion: suggestion?.name ?? null,
            auto,
            url: `${appUrl()}/quizzes/placement`,
          }),
        `quizres:${a.id}`,
      );
    } else if (a.quiz.group) {
      const group = a.quiz.group;
      await enqueue(
        tx,
        centerId,
        await teacherChats(tx, centerId, group.teacherId, true),
        (l) => quizResultStaff(l, { student: attemptName(a), title: a.quiz.title, group: group.name, correct: g.correct, total: g.total, percent, minutes, auto, url: `${appUrl()}/quizzes/${a.quizId}` }),
        `quizres:${a.id}`,
      );
    }
    return g;
  });
}

const attemptName = (a: { name: string | null; student: { firstName: string; lastName: string } | null; lead: { name: string } | null }) => a.name ?? (a.student ? fullName(a.student) : (a.lead?.name ?? "—"));

async function suggestionFor(centerId: string, reached: string, ok: boolean, branchIds: string[] | null = null) {
  const groups = await groupsAt(centerId, branchIds);
  const id = suggestGroup(groups, reached, ok);
  return groups.find((g) => g.id === id) ?? null;
}

/** Finish attempts whose time is up (lazily before a read, and from the worker). */
async function finishExpired(where: { quizId?: string; id?: { in: string[] } }, now: Date): Promise<number> {
  const due = await db.quizAttempt.findMany({ where: { ...where, submittedAt: null, deadlineAt: { lt: now } }, select: { id: true, deadlineAt: true } });
  let n = 0;
  for (const a of due) if (attemptState({ deadlineAt: a.deadlineAt, submittedAt: null }, now) === "expired" && (await finishAttempt(a.id, a.deadlineAt, true))) n++;
  return n;
}

/** The worker, every minute: attempts whose time ran out are graded and their results sent, even if nobody opens them again. */
export async function quizJob(now = new Date()): Promise<{ finished: number }> {
  const due = await db.quizAttempt.findMany({ where: { submittedAt: null, deadlineAt: { lt: now } }, select: { id: true }, take: 500 });
  return { finished: due.length ? await finishExpired({ id: { in: due.map((d) => d.id) } }, now) : 0 };
}

// ------------------------------------------------------------------ the Mini App: who is asking

/** Students a chat speaks for: its own student links and the children of its guardians (inside a center bot's scope: that center only). */
async function studentsOfChat(chatId: string) {
  const links = await validLinks(chatId);
  if (!links.guardianIds.length && !links.studentIds.length) return [];
  const guardians = await db.guardian.findMany({ where: { id: { in: links.guardianIds } }, select: { familyId: true } });
  return db.student.findMany({
    where: { status: "ACTIVE", center: { disabledAt: null }, OR: [{ familyId: { in: guardians.map((g) => g.familyId) } }, { id: { in: links.studentIds } }] },
    select: { id: true, firstName: true, lastName: true, centerId: true },
    orderBy: { firstName: "asc" },
  });
}

/** Group ids each student is in today. */
async function groupsOf(studentIds: string[], now: Date) {
  const today = fromISODate(todayISO(now));
  const rows = await db.enrollment.findMany({
    where: { studentId: { in: studentIds }, startDate: { lte: today }, OR: [{ endDate: null }, { endDate: { gte: today } }] },
    select: { studentId: true, groupId: true },
  });
  return rows;
}

/** A closed test stays in the list this long, so a student can still see the score. */
const CLOSED_SHOWN_MS = 7 * 86400_000;

export interface ChatQuiz {
  quizId: string;
  title: string;
  group: string;
  minutes: number;
  questions: number;
  status: "PUBLISHED" | "CLOSED";
  studentId: string;
  studentName: string;
  attempt: { id: string; state: AttemptState; correct: number | null; total: number } | null;
}

/** Tests of the groups this chat's students are in: open ones, and closed ones from the last week. */
export async function chatQuizzes(chatId: string, now = new Date()): Promise<ChatQuiz[]> {
  const students = await studentsOfChat(chatId);
  if (students.length === 0) return [];
  const enrolled = await groupsOf(students.map((s) => s.id), now);
  if (enrolled.length === 0) return [];
  const quizzes = await db.quiz.findMany({
    where: {
      kind: "TOPIC",
      groupId: { in: [...new Set(enrolled.map((e) => e.groupId))] },
      center: { disabledAt: null },
      OR: [{ status: "PUBLISHED" }, { status: "CLOSED", closedAt: { gte: new Date(now.getTime() - CLOSED_SHOWN_MS) } }],
    },
    include: { group: { select: { name: true } } },
    orderBy: { publishedAt: "desc" },
  });
  if (quizzes.length === 0) return [];
  const mine = { quizId: { in: quizzes.map((q) => q.id) }, studentId: { in: students.map((s) => s.id) } };
  const running = await db.quizAttempt.findMany({ where: { ...mine, submittedAt: null }, select: { id: true } });
  if (running.length) await finishExpired({ id: { in: running.map((a) => a.id) } }, now);
  const attempts = await db.quizAttempt.findMany({ where: mine });
  const out: ChatQuiz[] = [];
  for (const q of quizzes) {
    for (const s of students) {
      if (!enrolled.some((e) => e.studentId === s.id && e.groupId === q.groupId)) continue;
      const a = attempts.find((x) => x.quizId === q.id && x.studentId === s.id);
      // a closed test is only listed for those who took it
      if (q.status === "CLOSED" && !a) continue;
      out.push({
        quizId: q.id,
        title: q.title,
        group: q.group?.name ?? "",
        minutes: q.minutes,
        questions: q.questionIds.length,
        status: q.status as "PUBLISHED" | "CLOSED",
        studentId: s.id,
        studentName: fullName(s),
        attempt: a ? { id: a.id, state: attemptState(a, now), correct: a.correct, total: a.total } : null,
      });
    }
  }
  return out;
}

export interface AttemptView {
  id: string;
  kind: "TOPIC" | "PLACEMENT";
  title: string;
  name: string;
  state: AttemptState;
  deadlineAt: string;
  secondsLeft: number;
  /** never the keys */
  questions: { n: number; text: string; options: string[] }[];
  answers: string[];
  /** after finishing: the score, and (topic tests) which numbers were wrong — never the right answers */
  result: { correct: number; total: number; percent: number; wrong: number[] | null } | null;
}

async function view(attemptId: string, now: Date): Promise<AttemptView> {
  const a = await db.quizAttempt.findUniqueOrThrow({ where: { id: attemptId }, include: attemptInclude });
  const questions = await questionsInOrder(a.questionIds);
  const state = attemptState(a, now);
  const g = state === "submitted" ? gradeAttempt(questions, a.answers) : null;
  return {
    id: a.id,
    kind: a.quiz.kind,
    title: a.quiz.kind === "PLACEMENT" ? a.quiz.title : `${a.quiz.title}${a.quiz.group ? ` · ${a.quiz.group.name}` : ""}`,
    name: attemptName(a),
    state,
    deadlineAt: a.deadlineAt.toISOString(),
    secondsLeft: state === "open" ? secondsLeft(a.deadlineAt, now) : 0,
    questions: questions.map((q, i) => ({ n: i + 1, text: q.text, options: q.options })),
    answers: a.questionIds.map((_, i) => a.answers[i] ?? ""),
    result: g ? { correct: g.correct, total: g.total, percent: percentOf(g.correct, g.total), wrong: a.quiz.kind === "TOPIC" ? g.wrong : null } : null,
  };
}

/** The attempt, when this chat may see it: the chat that started it, or (topic tests) another chat linked to the student. */
async function attemptForChat(attemptId: string, chatId: string) {
  const a = await db.quizAttempt.findUnique({ where: { id: attemptId }, select: { id: true, chatId: true, studentId: true, deadlineAt: true, submittedAt: true, questionIds: true, quiz: { select: { kind: true, centerId: true } } } });
  if (!a) return null;
  if (a.chatId === chatId) return a;
  if (a.quiz.kind === "TOPIC" && a.studentId && (await studentsOfChat(chatId)).some((s) => s.id === a.studentId)) return a;
  return null;
}

/** Open (or resume) a student's attempt: the clock starts now, once; a second open resumes the same attempt. */
export async function startQuizAttempt(chatId: string, quizId: string, studentId: string, now = new Date()): Promise<AttemptView> {
  const student = (await studentsOfChat(chatId)).find((s) => s.id === studentId);
  const quiz = await db.quiz.findFirst({ where: { id: quizId, kind: "TOPIC", center: { disabledAt: null } } });
  if (!student || !quiz || student.centerId !== quiz.centerId) throw new UserError("quizzes.notFound");
  const existing = await db.quizAttempt.findUnique({ where: { quizId_studentId: { quizId, studentId } }, select: { id: true } });
  if (existing) {
    await finishExpired({ id: { in: [existing.id] } }, now);
    return view(existing.id, now);
  }
  if (quiz.status !== "PUBLISHED") throw new UserError("quizzes.closed");
  if (!(await groupsOf([studentId], now)).some((e) => e.groupId === quiz.groupId)) throw new UserError("quizzes.notFound");
  const created = await db.quizAttempt
    .create({ data: { quizId, studentId, chatId, questionIds: quiz.questionIds, answers: quiz.questionIds.map(() => ""), startedAt: now, deadlineAt: deadlineOf(now, quiz.minutes), total: quiz.questionIds.length } })
    .catch(async (e: { code?: string }) => {
      // two taps at once: the other one created it
      if (e?.code !== "P2002") throw e;
      return db.quizAttempt.findUniqueOrThrow({ where: { quizId_studentId: { quizId, studentId } } });
    });
  return view(created.id, now);
}

export async function attemptViewFor(attemptId: string, chatId: string, now = new Date()): Promise<AttemptView> {
  const a = await attemptForChat(attemptId, chatId);
  if (!a) throw new UserError("quizzes.notFound");
  await finishExpired({ id: { in: [a.id] } }, now);
  return view(a.id, now);
}

export type SaveAnswerResult = { ok: true } | { ok: false; reason: "closed" | "invalid" };

/** One answer (question index from 0; "" clears). Refused past the deadline: the attempt is finished then. */
export async function saveQuizAnswer(attemptId: string, chatId: string, q: number, raw: string, now = new Date()): Promise<SaveAnswerResult> {
  const a = await attemptForChat(attemptId, chatId);
  if (!a || !Number.isInteger(q) || q < 0 || q >= a.questionIds.length) throw new UserError("quizzes.notFound");
  const state = attemptState(a, now);
  if (state === "expired") await finishAttempt(a.id, a.deadlineAt, true);
  if (state !== "open") return { ok: false, reason: "closed" };
  const question = await db.question.findUnique({ where: { id: a.questionIds[q] }, select: { options: true } });
  const value = cleanQuizAnswer(String(raw).slice(0, 40), question?.options.length ?? 0);
  if (value === null) return { ok: false, reason: "invalid" };
  const saved = await db.$transaction(async (tx) => {
    // one row lock: two quick taps never overwrite each other's answer
    await tx.$queryRaw`SELECT id FROM "QuizAttempt" WHERE id = ${a.id} FOR UPDATE`;
    const row = await tx.quizAttempt.findUniqueOrThrow({ where: { id: a.id }, select: { answers: true, submittedAt: true } });
    if (row.submittedAt) return false;
    const answers = a.questionIds.map((_, i) => row.answers[i] ?? "");
    answers[q] = value;
    await tx.quizAttempt.update({ where: { id: a.id }, data: { answers } });
    return true;
  });
  return saved ? { ok: true } : { ok: false, reason: "closed" };
}

/** The student's "finish": graded now (or at the deadline when the time is already up). */
export async function submitQuizAttempt(attemptId: string, chatId: string, now = new Date()): Promise<AttemptView> {
  const a = await attemptForChat(attemptId, chatId);
  if (!a) throw new UserError("quizzes.notFound");
  const state = attemptState(a, now);
  if (state === "open") await finishAttempt(a.id, now, false);
  else if (state === "expired") await finishAttempt(a.id, a.deadlineAt, true);
  return view(a.id, now);
}

// ------------------------------------------------------------------ placement

export async function placementTemplate(centerId: string) {
  return db.quiz.findFirst({ where: { centerId, kind: "PLACEMENT" }, orderBy: { createdAt: "asc" } });
}

export interface PlacementSettings {
  count: number;
  passPercent: number;
  minutes: number;
  open: boolean;
}

/** The owner sets up the placement test: questions per attempt, pass mark, time; open = the start link works. */
export async function savePlacement(ctx: Ctx, s: PlacementSettings): Promise<void> {
  if (!Number.isInteger(s.count) || s.count < PLACEMENT_COUNT.min || s.count > PLACEMENT_COUNT.max) throw new UserError("quizzes.badPlacementCount", { min: PLACEMENT_COUNT.min, max: PLACEMENT_COUNT.max });
  if (!Number.isInteger(s.passPercent) || s.passPercent < 1 || s.passPercent > 100) throw new UserError("quizzes.badPass");
  checkMinutes(s.minutes);
  const data = { questionCount: s.count, passPercent: s.passPercent, minutes: s.minutes, status: s.open ? ("PUBLISHED" as const) : ("CLOSED" as const) };
  const before = await placementTemplate(ctx.centerId);
  await db.$transaction(async (tx) => {
    const q = before
      ? await tx.quiz.update({ where: { id: before.id }, data: { ...data, ...(s.open && !before.publishedAt ? { publishedAt: new Date() } : {}) } })
      : await tx.quiz.create({ data: { centerId: ctx.centerId, kind: "PLACEMENT", title: "Kirish testi", ...data, publishedAt: s.open ? new Date() : null, createdById: ctx.userId } });
    await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Quiz", entityId: q.id, action: "placement.settings", before: before ? { count: before.questionCount, pass: before.passPercent, minutes: before.minutes, status: before.status } : undefined, after: data });
  });
}

/** The center a placement start link is for: the center bot's own center, else the slug in the link. */
export async function placementCenter(slug: string | null, scopeCenterId: string | null) {
  const where = scopeCenterId ? { id: scopeCenterId } : slug ? { slug } : null;
  if (!where) return null;
  return db.center.findFirst({ where: { ...where, disabledAt: null }, select: { id: true, name: true, slug: true } });
}

/** What the start screen needs: the topics to pick from and this chat's earlier attempt, if any. */
export async function placementInfo(centerId: string, chatId: string, now = new Date()) {
  const template = await placementTemplate(centerId);
  if (!template || template.status !== "PUBLISHED") return null;
  const [topics, known, mine] = await Promise.all([
    bankOverview(centerId),
    db.student.findFirst({ where: { centerId, telegramChatId: chatId, status: "ACTIVE" }, select: { firstName: true, lastName: true } }),
    db.quizAttempt.findFirst({ where: { quizId: template.id, chatId }, orderBy: { createdAt: "desc" }, select: { id: true, deadlineAt: true, submittedAt: true } }),
  ]);
  return {
    minutes: template.minutes,
    count: template.questionCount,
    topics: reachableTopics(topics).map((t) => ({ id: t.id, code: t.code, title: t.title, depth: t.depth })),
    /** a known student (their own linked chat): no name or phone asked */
    known: known ? fullName(known) : null,
    /** an attempt still running in this chat: resume it */
    running: mine && attemptState(mine, now) === "open" ? mine.id : null,
  };
}

export interface PlacementStart {
  topicId: string;
  firstName?: string | null;
  lastName?: string | null;
  phone?: string | null;
}

/**
 * Start a placement attempt: questions up to the topic the person reached. A known student (their own chat)
 * is taken as they are; anyone else leaves a name and a phone and becomes (or joins) a lead. One attempt per
 * student, and per name in a chat (a parent may test two children). Nobody is enrolled here.
 */
export async function startPlacement(centerId: string, chatId: string, input: PlacementStart, now = new Date()): Promise<AttemptView> {
  const template = await placementTemplate(centerId);
  if (!template || template.status !== "PUBLISHED") throw new UserError("quizzes.closed");
  const running = await db.quizAttempt.findFirst({ where: { quizId: template.id, chatId, submittedAt: null }, select: { id: true, deadlineAt: true, submittedAt: true } });
  if (running) {
    if (attemptState(running, now) === "open") return view(running.id, now);
    await finishAttempt(running.id, running.deadlineAt, true);
  }
  const topic = await db.questionTopic.findFirst({ where: { id: input.topicId, centerId } });
  if (!topic) throw new UserError("quizzes.notFound");
  const student = await db.student.findFirst({ where: { centerId, telegramChatId: chatId, status: "ACTIVE" }, select: { id: true, firstName: true, lastName: true } });
  let name: string;
  let phone: string | null = null;
  if (student) {
    if (await db.quizAttempt.findUnique({ where: { quizId_studentId: { quizId: template.id, studentId: student.id } }, select: { id: true } })) throw new UserError("quizzes.placementDone");
    name = fullName(student);
  } else {
    const first = input.firstName?.trim().slice(0, 60) ?? "";
    const last = input.lastName?.trim().slice(0, 60) ?? "";
    if (!first || !last) throw new UserError("quizzes.needName");
    phone = normalizePhone(input.phone);
    if (!phone) throw new UserError("quizzes.badPhone");
    name = `${first} ${last}`;
    const done = await db.quizAttempt.findMany({ where: { quizId: template.id, chatId }, select: { name: true } });
    if (done.some((d) => d.name?.toLocaleLowerCase("uz") === name.toLocaleLowerCase("uz"))) throw new UserError("quizzes.placementDone");
  }
  const pool = await approvedPool(centerId);
  const picked = pickPlacement(pool, topic.code, template.questionCount, `${chatId}:${topic.code}:${todayISO(now)}`);
  if (picked.length < PLACEMENT_MIN_DRAWN) throw new UserError("quizzes.placementFew");
  const ids = picked.map((q) => q.id);
  const attemptId = await db.$transaction(async (tx) => {
    let leadId: string | null = null;
    if (!student) {
      const existing = await tx.lead.findFirst({ where: { centerId, phone, archivedAt: null, stage: { notIn: ["ENROLLED", "LOST"] } }, orderBy: { createdAt: "asc" }, select: { id: true } });
      leadId = existing?.id ?? null;
      if (!leadId) {
        const lead = await tx.lead.create({ data: { centerId, name, phone, source: "Kirish testi", nextContactAt: fromISODate(todayISO(now)) } });
        await audit(tx, { centerId, actor: "PUBLIC", entity: "Lead", entityId: lead.id, action: "create.placement", after: { name, phone } });
        leadId = lead.id;
      }
      await tx.leadNote.create({ data: { leadId, text: `🧭 Kirish testini boshladi: ${name}, ${topic.code}. ${topic.title} mavzusigacha`, actor: "PUBLIC" } });
    }
    const a = await tx.quizAttempt.create({
      data: { quizId: template.id, studentId: student?.id ?? null, leadId, chatId, name, topicId: topic.id, questionIds: ids, answers: ids.map(() => ""), startedAt: now, deadlineAt: deadlineOf(now, template.minutes), total: ids.length },
    });
    return a.id;
  });
  return view(attemptId, now);
}

export interface PlacementRow {
  id: string;
  name: string;
  phone: string | null;
  topic: string | null;
  state: AttemptState;
  correct: number | null;
  total: number;
  percent: number | null;
  passed: boolean | null;
  startedAt: Date;
  suggestedGroupId: string | null;
  placedGroup: string | null;
  placedAt: Date | null;
  leadId: string | null;
  studentId: string | null;
}

/** Placement attempts, newest first, with the score, pass/fail and the suggested group. */
export async function placementResults(ctx: Ctx, now = new Date()) {
  const template = await placementTemplate(ctx.centerId);
  const groups = await groupsAt(ctx.centerId, ctx.branchIds);
  if (!template) return { template: null, rows: [] as PlacementRow[], groups };
  await finishExpired({ quizId: template.id }, now);
  const attempts = await db.quizAttempt.findMany({ where: { quizId: template.id }, include: attemptInclude, orderBy: { createdAt: "desc" }, take: 200 });
  const allQuestions = await questionsInOrder([...new Set(attempts.flatMap((a) => a.questionIds))]);
  const byId = new Map(allQuestions.map((q) => [q.id, q]));
  const placed = await db.group.findMany({ where: { id: { in: attempts.map((a) => a.placedGroupId).filter((x): x is string => !!x) } }, select: { id: true, name: true } });
  const rows: PlacementRow[] = attempts.map((a) => {
    const state = attemptState(a, now);
    const g = state === "submitted" ? gradeAttempt(a.questionIds.map((id) => byId.get(id)!), a.answers) : null;
    const ok = g ? passed(g.correct, g.total, template.passPercent) : null;
    return {
      id: a.id,
      name: attemptName(a),
      phone: a.lead?.phone ?? a.student?.phone ?? null,
      topic: a.topic ? `${a.topic.code}. ${a.topic.title}` : null,
      state,
      correct: g?.correct ?? null,
      total: a.total,
      percent: g ? percentOf(g.correct, g.total) : null,
      passed: ok,
      startedAt: a.startedAt,
      suggestedGroupId: g && a.topic ? suggestGroup(groups, a.topic.code, !!ok) : null,
      placedGroup: placed.find((p) => p.id === a.placedGroupId)?.name ?? null,
      placedAt: a.placedAt,
      leadId: a.leadId,
      studentId: a.studentId,
    };
  });
  return { template, rows, groups };
}

/**
 * The owner's approval: the person goes into the chosen group as TRIAL from its next lesson. A lead becomes a
 * student first (a new family: the phone was typed, not proved, so it never joins an existing family).
 */
export async function placeAttempt(ctx: Ctx, attemptId: string, groupId: string, now = new Date()): Promise<{ enrollmentId: string }> {
  const template = await placementTemplate(ctx.centerId);
  const a = template ? await db.quizAttempt.findFirst({ where: { id: attemptId, quizId: template.id }, include: { lead: true } }) : null;
  if (!a) throw new UserError("error.notFound");
  if (!a.submittedAt) throw new UserError("quizzes.notFinished");
  if (a.placedAt) throw new UserError("quizzes.alreadyPlaced");
  const group = await db.group.findFirst({ where: { id: groupId, centerId: ctx.centerId, status: { in: ["ACTIVE", "PLANNED"] } } });
  if (!group || !canAccessBranch(ctx, group.branchId)) throw new UserError("error.notFound");
  let studentId = a.studentId;
  if (!studentId) {
    const [firstName, ...rest] = (a.name ?? a.lead?.name ?? "").trim().split(/\s+/);
    studentId = await db.$transaction(async (tx) => {
      const id = await createStudentWithFamily(
        tx,
        { userId: ctx.userId, centerId: ctx.centerId, actor: "USER" },
        { firstName: firstName || "—", lastName: rest.join(" "), phone: a.lead?.phone ?? null, branchId: group.branchId, source: "Kirish testi", leadId: a.leadId },
      );
      // kept on the attempt at once: a retry after a failed enrollment does not create the student twice
      await tx.quizAttempt.update({ where: { id: a.id }, data: { studentId: id } });
      return id;
    });
  }
  const start = (await nextLessonDate(db, group.id, todayISO(now))) ?? todayISO(now);
  const enrollmentId = await enrollStudent({ userId: ctx.userId, centerId: ctx.centerId }, { studentId, groupId: group.id, startDate: start, trial: true });
  await db.$transaction(async (tx) => {
    await tx.quizAttempt.update({ where: { id: a.id }, data: { placedGroupId: group.id, placedEnrollmentId: enrollmentId, placedAt: now, placedById: ctx.userId } });
    await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "QuizAttempt", entityId: a.id, action: "place", after: { groupId: group.id, studentId, enrollmentId } });
  });
  return { enrollmentId };
}

/** For the group page and the test form: the bank's topics in book order. */
export async function topicOptions(centerId: string) {
  const topics = await db.questionTopic.findMany({ where: { centerId }, select: { id: true, code: true, title: true } });
  return topics.sort((a, b) => compareCodes(a.code, b.code));
}
