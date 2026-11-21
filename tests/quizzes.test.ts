// Timed tests end to end: a topic test built from the approved bank, the owner's draft review, publishing to the
// group (students or parents by school grade, with a Mini App button), taking it through the signed Mini App API,
// the deadline, results to the owner first and to parents only on the owner's press; the placement test from the
// bot's start link to the owner's approval. Run: npm run test:integration
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import type { Bot } from "grammy";
import type { Update } from "grammy/types";
import { db } from "@/lib/db";
import { addDays, fromISODate, todayISO } from "@/lib/dates";
import { buildCtx, loadUser } from "@/lib/ctx-core";
import { initDataHash } from "@/lib/telegram-webapp";
import { linkChat } from "@/worker/bot/data";
import { createBot } from "@/worker/bot";
import { POST } from "@/app/api/tg/quiz/route";
import {
  attemptViewFor,
  closeQuiz,
  createTopicQuiz,
  placeAttempt,
  placementInfo,
  placementResults,
  publishQuiz,
  quizDetail,
  quizJob,
  removeQuizQuestion,
  replaceQuizQuestion,
  saveQuizAnswer,
  savePlacement,
  sendResultsToParents,
  setGroupTopic,
  startPlacement,
  startQuizAttempt,
  submitQuizAttempt,
  type AttemptView,
} from "@/lib/services/quizzes";
import { withinReach } from "@/lib/quizzes/select";

const TOKEN = "555:quiz-test";
const today = todayISO();
const CHAT = { ali: "955500001", layloParent: "955500002", owner: "955500003", teacher: "955500004", stranger: "955500005", admin: "955500006", aliParent: "955500007" };
const PHONE = { ali: "998915550001", layloParent: "998915550002", owner: "998915550003", teacher: "998915550004", admin: "998915550006", aliParent: "998915550007", other: "998915550008" };

let centerId = "";
let otherCenterId = "";
let ownerId = "";
let adminId = "";
let otherOwnerId = "";
let groupId = "";
let lowGroupId = "";
let midGroupId = "";
const sid = { ali: "", laylo: "" };
const topic: Record<string, string> = {};
let otherTopicId = "";
let figureId = "";
let draftQuestionId = "";

const ctxOf = async (userId: string) => buildCtx((await loadUser(userId))!);

function initData(userId: string) {
  const p = new URLSearchParams({ query_id: "Q", user: JSON.stringify({ id: Number(userId), first_name: "T", language_code: "uz" }), auth_date: String(Math.floor(Date.now() / 1000)) });
  p.set("hash", initDataHash([...p.entries()], TOKEN));
  return p.toString();
}
async function api(chat: string, action: string, extra: Record<string, unknown> = {}) {
  const r = await POST(new Request("http://localhost/api/tg/quiz", { method: "POST", body: JSON.stringify({ action, initData: initData(chat), ...extra }) }));
  return { status: r.status, body: (await r.json()) as Record<string, unknown> };
}

beforeAll(async () => {
  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
  process.env.APP_URL = "https://sabaq.test";
  const c = await db.center.create({ data: { name: "Test markazi", slug: "quiz-test", settings: { homework: { directFromGrade: 9 } } } });
  centerId = c.id;
  otherCenterId = (await db.center.create({ data: { name: "Boshqa", slug: "quiz-other" } })).id;
  const branch = await db.branch.create({ data: { centerId, name: "Markaz" } });
  const hash = await bcrypt.hash("x-password-1", 4);
  otherOwnerId = (await db.user.create({ data: { centerId: otherCenterId, phone: PHONE.other, name: "Boshqa ega", passwordHash: hash, role: "OWNER", perms: [] } })).id;
  ownerId = (await db.user.create({ data: { centerId, phone: PHONE.owner, name: "Ega", passwordHash: hash, role: "OWNER", perms: [] } })).id;
  adminId = (await db.user.create({ data: { centerId, phone: PHONE.admin, name: "Admin", passwordHash: hash, role: "ADMIN", perms: ["groups.edit", "students.edit"] } })).id;
  const teacherId = (await db.user.create({ data: { centerId, phone: PHONE.teacher, name: "Ustoz", passwordHash: hash, role: "TEACHER", isTeacher: true, perms: [] } })).id;
  const course = await db.course.create({ data: { centerId, name: "Matematika", pricingType: "SUBSCRIPTION", price: 300_000 } });
  const mkGroup = async (code: number, name: string) => (await db.group.create({ data: { centerId, branchId: branch.id, courseId: course.id, teacherId, code, name, startDate: fromISODate(addDays(today, -30)) } })).id;
  groupId = await mkGroup(1, "Algebra 9");
  lowGroupId = await mkGroup(2, "Boshlang'ich");
  midGroupId = await mkGroup(3, "O'rta");
  for (const g of [groupId, lowGroupId, midGroupId]) await db.lesson.create({ data: { groupId: g, date: fromISODate(addDays(today, 2)), startTime: "15:00", endTime: "16:30", teacherId } });

  // the bank: chapters 1–3; questions approved, plus a draft and a picture question that must never be drawn
  for (const [code, title] of [["1", "Sonlar"], ["1.1", "Qo'shish"], ["1.2", "Ayirish"], ["2", "Tenglamalar"], ["2.1", "Chiziqli"], ["2.2", "Kvadrat"], ["3", "Funksiyalar"], ["3.1", "Grafik"]] as const) {
    topic[code] = (await db.questionTopic.create({ data: { centerId, code, title } })).id;
  }
  otherTopicId = (await db.questionTopic.create({ data: { centerId: otherCenterId, code: "1", title: "Boshqa" } })).id;
  const q = (code: string, number: number, extra: Record<string, unknown> = {}) =>
    db.question.create({ data: { centerId, topicId: topic[code], number, text: `${code} savol ${number}`, options: ["1", "2", "3", "4"], answer: "B", keyCheck: "STATED", source: "BOOK", status: "APPROVED", ...extra } });
  for (const code of ["1.1", "1.2", "2.1", "3.1"]) for (let n = 1; n <= 6; n++) await q(code, n);
  for (let n = 1; n <= 4; n++) await q("2.2", n, n % 2 ? { options: [], answer: "-4" } : {});
  draftQuestionId = (await q("2.2", 5, { status: "DRAFT" })).id;
  figureId = (await q("2.2", 6, { needsFigure: true })).id;

  const start = fromISODate(addDays(today, -20));
  const family = async (name: string, phone: string) => {
    const f = await db.family.create({ data: { centerId, name } });
    await db.guardian.create({ data: { familyId: f.id, name, phone, isPrimary: true } });
    return f.id;
  };
  const student = async (familyId: string, firstName: string, schoolGrade: number, phone: string | null) => {
    const s = await db.student.create({ data: { centerId, familyId, branchId: branch.id, firstName, lastName: "Test", schoolGrade, phone } });
    await db.enrollment.create({ data: { studentId: s.id, groupId, startDate: start, activatedAt: start, status: "ACTIVE" } });
    return s.id;
  };
  sid.ali = await student(await family("Alilar", PHONE.aliParent), "Ali", 10, PHONE.ali);
  sid.laylo = await student(await family("Laylolar", PHONE.layloParent), "Laylo", 5, null);
  for (const [chat, phone] of [[CHAT.ali, PHONE.ali], [CHAT.aliParent, PHONE.aliParent], [CHAT.layloParent, PHONE.layloParent], [CHAT.owner, PHONE.owner], [CHAT.teacher, PHONE.teacher], [CHAT.admin, PHONE.admin]] as const) await linkChat(chat, phone, "uz");
});

afterAll(() => {
  delete process.env.APP_URL;
});

let quizId = "";

describe("building a topic test", () => {
  it("draws only approved questions without pictures from the topic and its sub-topics", async () => {
    const ctx = await ctxOf(ownerId);
    quizId = await createTopicQuiz(ctx, { groupId, topicId: topic["2"], count: 50, minutes: 15 });
    const quiz = await db.quiz.findUniqueOrThrow({ where: { id: quizId } });
    // 2.1: 6, 2.2: 4 approved (the draft and the picture one are left out)
    expect(quiz.questionIds).toHaveLength(10);
    expect(quiz.questionIds).not.toContain(draftQuestionId);
    expect(quiz.questionIds).not.toContain(figureId);
    expect(quiz).toMatchObject({ status: "DRAFT", title: "2. Tenglamalar", minutes: 15, centerId });
  });

  it("refuses another center's topic, a bad time and an empty topic", async () => {
    const ctx = await ctxOf(ownerId);
    await expect(createTopicQuiz(ctx, { groupId, topicId: otherTopicId, count: 5, minutes: 10 })).rejects.toMatchObject({ key: "error.notFound" });
    await expect(createTopicQuiz(ctx, { groupId, topicId: topic["2"], count: 5, minutes: 0 })).rejects.toMatchObject({ key: "quizzes.badMinutes" });
    await expect(createTopicQuiz(ctx, { groupId, topicId: topic["1"], count: 5, minutes: 10 }).then(() => "ok")).resolves.toBe("ok");
    const empty = await db.questionTopic.create({ data: { centerId, code: "9", title: "Bo'sh" } });
    await expect(createTopicQuiz(ctx, { groupId, topicId: empty.id, count: 5, minutes: 10 })).rejects.toMatchObject({ key: "quizzes.noQuestions" });
  });

  it("lets the owner remove and replace questions while it is a draft", async () => {
    const ctx = await ctxOf(ownerId);
    const small = await createTopicQuiz(ctx, { groupId, topicId: topic["2.2"], count: 3, minutes: 10 });
    let quiz = await db.quiz.findUniqueOrThrow({ where: { id: small } });
    const [first, second] = quiz.questionIds;
    await replaceQuizQuestion(ctx, small, first);
    quiz = await db.quiz.findUniqueOrThrow({ where: { id: small } });
    expect(quiz.questionIds[0]).not.toBe(first);
    expect(new Set(quiz.questionIds).size).toBe(3);
    // only the replaced one is left out now
    await replaceQuizQuestion(ctx, small, second);
    quiz = await db.quiz.findUniqueOrThrow({ where: { id: small } });
    expect(quiz.questionIds[1]).toBe(first);
    // a test holding every approved question of its topic has nothing to swap in
    const full = await createTopicQuiz(ctx, { groupId, topicId: topic["2.2"], count: 50, minutes: 10 });
    await expect(replaceQuizQuestion(ctx, full, (await db.quiz.findUniqueOrThrow({ where: { id: full } })).questionIds[0])).rejects.toMatchObject({ key: "quizzes.noReplacement" });
    await removeQuizQuestion(ctx, small, quiz.questionIds[0]);
    await removeQuizQuestion(ctx, small, quiz.questionIds[1]);
    await expect(removeQuizQuestion(ctx, small, quiz.questionIds[2])).rejects.toMatchObject({ key: "quizzes.lastQuestion" });
  });
});

describe("publishing and taking it in the Mini App", () => {
  let aliAttempt: AttemptView;

  it("tells the 10th grader directly and the 5th grader's parent, each with a button to the test", async () => {
    const r = await publishQuiz(await ctxOf(ownerId), quizId);
    expect(r.notified).toBe(2);
    const rows = await db.notification.findMany({ where: { dedupeKey: { startsWith: `quiz:${quizId}:` } } });
    expect(rows.map((n) => n.chatId).sort()).toEqual([CHAT.ali, CHAT.layloParent].sort());
    expect(rows.every((n) => (n.button as { path: string }).path === `/tg/quiz?q=${quizId}`)).toBe(true);
    expect(rows.find((n) => n.chatId === CHAT.layloParent)!.text).toContain("Laylo");
    await expect(publishQuiz(await ctxOf(ownerId), quizId)).rejects.toMatchObject({ key: "quizzes.notDraft" });
  });

  it("lists the test for the student's chat, refuses unsigned calls and unlinked chats see nothing", async () => {
    const r = await api(CHAT.ali, "list");
    expect(r.status).toBe(200);
    expect(r.body.linked).toBe(true);
    expect(r.body.quizzes).toEqual([expect.objectContaining({ quizId, studentId: sid.ali, questions: 10, minutes: 15, attempt: null })]);
    const bad = await POST(new Request("http://localhost/api/tg/quiz", { method: "POST", body: JSON.stringify({ action: "list", initData: "user=%7B%22id%22%3A1%7D&hash=" + "0".repeat(64) }) }));
    expect(bad.status).toBe(401);
    expect((await api(CHAT.stranger, "list")).body).toMatchObject({ linked: false, quizzes: [] });
  });

  it("starts the clock once and never sends the keys", async () => {
    const r = await api(CHAT.ali, "start", { quizId, studentId: sid.ali });
    aliAttempt = r.body.attempt as AttemptView;
    expect(aliAttempt).toMatchObject({ state: "open", kind: "TOPIC", result: null });
    expect(aliAttempt.secondsLeft).toBeGreaterThan(14 * 60);
    expect(JSON.stringify(r.body)).not.toMatch(/"answer"/);
    const again = await api(CHAT.ali, "start", { quizId, studentId: sid.ali });
    expect((again.body.attempt as AttemptView).id).toBe(aliAttempt.id);
    expect((again.body.attempt as AttemptView).deadlineAt).toBe(aliAttempt.deadlineAt);
    // another student's test cannot be started from this chat
    expect((await api(CHAT.ali, "start", { quizId, studentId: sid.laylo })).status).toBe(400);
  });

  it("saves answers that fit the question and refuses the rest", async () => {
    const att = await db.quizAttempt.findUniqueOrThrow({ where: { id: aliAttempt.id } });
    const qs = await db.question.findMany({ where: { id: { in: att.questionIds } } });
    const byId = new Map(qs.map((x) => [x.id, x]));
    const choice = att.questionIds.findIndex((id) => byId.get(id)!.options.length === 4);
    const open = att.questionIds.findIndex((id) => byId.get(id)!.options.length === 0);
    expect((await api(CHAT.ali, "answer", { attemptId: aliAttempt.id, q: choice, value: "E" })).body).toMatchObject({ ok: false, reason: "invalid" });
    expect((await api(CHAT.ali, "answer", { attemptId: aliAttempt.id, q: open, value: "B" })).body).toMatchObject({ ok: false, reason: "invalid" });
    // everything right except the first question
    for (let i = 0; i < att.questionIds.length; i++) {
      const right = byId.get(att.questionIds[i])!.answer;
      const value = i === 0 ? (right === "B" ? "A" : "5") : right === "-4" ? "−4" : "b";
      expect((await api(CHAT.ali, "answer", { attemptId: aliAttempt.id, q: i, value })).body).toMatchObject({ ok: true });
    }
    // a chat that is not the student's sees nothing
    expect((await api(CHAT.layloParent, "view", { attemptId: aliAttempt.id })).status).toBe(400);
  });

  it("on finish shows the score and the wrong numbers, and the owner and teacher hear at once", async () => {
    const r = await api(CHAT.ali, "submit", { attemptId: aliAttempt.id });
    const v = r.body.attempt as AttemptView;
    expect(v.state).toBe("submitted");
    expect(v.result).toEqual({ correct: 9, total: 10, percent: 90, wrong: [1] });
    const notes = await db.notification.findMany({ where: { dedupeKey: { startsWith: `quizres:${aliAttempt.id}` } } });
    expect(notes.map((n) => n.chatId).sort()).toEqual([CHAT.owner, CHAT.teacher].sort());
    expect(notes[0].text).toContain("9/10");
    // finished: answers are refused
    expect((await api(CHAT.ali, "answer", { attemptId: aliAttempt.id, q: 0, value: "B" })).body).toMatchObject({ ok: false, reason: "closed" });
  });

  it("a parent answers for the 5th grader; past the deadline answers are refused and the attempt finishes itself", async () => {
    const list = await api(CHAT.layloParent, "list");
    expect((list.body.quizzes as { studentId: string }[]).map((q) => q.studentId)).toEqual([sid.laylo]);
    const startedAt = new Date(Date.now() - 20 * 60_000);
    const v = await startQuizAttempt(CHAT.layloParent, quizId, sid.laylo, startedAt);
    expect(await saveQuizAnswer(v.id, CHAT.layloParent, 0, "B", new Date(startedAt.getTime() + 60_000))).toEqual({ ok: true });
    expect(await saveQuizAnswer(v.id, CHAT.layloParent, 1, "B")).toEqual({ ok: false, reason: "closed" });
    const row = await db.quizAttempt.findUniqueOrThrow({ where: { id: v.id } });
    expect(row).toMatchObject({ autoSubmitted: true, total: 10 });
    expect(row.submittedAt!.getTime()).toBe(row.deadlineAt.getTime());
    expect((await attemptViewFor(v.id, CHAT.layloParent)).result?.total).toBe(10);
  });

  it("the worker finishes an attempt nobody came back to", async () => {
    const ctx = await ctxOf(ownerId);
    const other = await createTopicQuiz(ctx, { groupId, topicId: topic["1"], count: 4, minutes: 5 });
    await publishQuiz(ctx, other);
    const v = await startQuizAttempt(CHAT.ali, other, sid.ali, new Date(Date.now() - 10 * 60_000));
    expect((await quizJob()).finished).toBeGreaterThanOrEqual(1);
    expect(await db.quizAttempt.findUniqueOrThrow({ where: { id: v.id } })).toMatchObject({ autoSubmitted: true, correct: 0 });
    // closing a test finishes a running attempt with what it has
    const third = await createTopicQuiz(ctx, { groupId, topicId: topic["3"], count: 3, minutes: 30 });
    await publishQuiz(ctx, third);
    const running = await startQuizAttempt(CHAT.ali, third, sid.ali);
    await submitQuizAttempt(running.id, CHAT.ali).then(() => undefined);
    const laylo = await startQuizAttempt(CHAT.layloParent, third, sid.laylo);
    await closeQuiz(ctx, third);
    expect(await db.quizAttempt.findUniqueOrThrow({ where: { id: laylo.id } })).toMatchObject({ autoSubmitted: true });
    expect((await api(CHAT.layloParent, "start", { quizId: third, studentId: sid.laylo })).body.attempt).toMatchObject({ state: "submitted" });
  });
});

describe("results", () => {
  it("one row per student with score, time and wrong numbers", async () => {
    const d = await quizDetail(await ctxOf(ownerId), quizId);
    expect(d.results.map((r) => [r.name, r.state, r.correct])).toEqual([
      ["Test Ali", "submitted", 9],
      ["Test Laylo", "submitted", expect.any(Number)],
    ]);
    expect(d.results[0].wrong).toEqual([1]);
    expect(d.wrongCount[0]).toBeGreaterThanOrEqual(1);
    // another center's owner never sees it
    await expect(quizDetail(await ctxOf(otherOwnerId), quizId)).rejects.toMatchObject({ key: "error.notFound" });
  });

  it("reach parents only when an owner sends them, once per student", async () => {
    await expect(sendResultsToParents(await ctxOf(adminId), quizId)).rejects.toMatchObject({ key: "quizzes.ownerOnly" });
    expect(await db.notification.count({ where: { dedupeKey: { startsWith: "quizpar:" } } })).toBe(0);
    const r = await sendResultsToParents(await ctxOf(ownerId), quizId);
    // Ali's parent and Laylo's parent; never Ali's own chat
    expect(r).toEqual({ sent: 2, students: 2 });
    const rows = await db.notification.findMany({ where: { dedupeKey: { startsWith: "quizpar:" } } });
    expect(rows.map((n) => n.chatId).sort()).toEqual([CHAT.aliParent, CHAT.layloParent].sort());
    expect((await sendResultsToParents(await ctxOf(ownerId), quizId)).sent).toBe(0);
  });
});

describe("placement", () => {
  let attemptId = "";

  it("the owner sets it up and marks each group's topic", async () => {
    const ctx = await ctxOf(ownerId);
    await expect(savePlacement(ctx, { count: 2, passPercent: 70, minutes: 20, open: true })).rejects.toMatchObject({ key: "quizzes.badPlacementCount" });
    await savePlacement(ctx, { count: 10, passPercent: 70, minutes: 20, open: true });
    await setGroupTopic(ctx, lowGroupId, topic["1.2"]);
    await setGroupTopic(ctx, midGroupId, topic["2.1"]);
    await setGroupTopic(ctx, groupId, topic["2.2"]);
    await expect(setGroupTopic(ctx, groupId, otherTopicId)).rejects.toMatchObject({ key: "error.notFound" });
    expect((await db.group.findUniqueOrThrow({ where: { id: groupId } })).currentTopicId).toBe(topic["2.2"]);
  });

  it("the bot's start link answers with a button that opens the test", async () => {
    const calls: { method: string; payload: Record<string, unknown> }[] = [];
    const bot: Bot = createBot("123:test");
    bot.botInfo = { id: 1, is_bot: true, first_name: "LMS", username: "lms_test_bot", can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false } as Bot["botInfo"];
    bot.api.config.use(async (_prev, method, payload) => {
      calls.push({ method, payload: payload as Record<string, unknown> });
      return { ok: true, result: method === "sendMessage" ? { message_id: 1, date: 0, chat: { id: 1, type: "private" }, text: "" } : true } as never;
    });
    const u = { update_id: 1, message: { message_id: 1, date: 0, chat: { id: Number(CHAT.stranger), type: "private", first_name: "T" }, from: { id: Number(CHAT.stranger), is_bot: false, first_name: "T" }, text: "/start pt_quiz-test", entities: [{ type: "bot_command", offset: 0, length: 6 }] } } as unknown as Update;
    await bot.handleUpdate(u);
    const sent = calls.find((c) => c.method === "sendMessage")!;
    expect(sent.payload.text).toContain("Test markazi");
    expect(sent.payload.reply_markup).toEqual({ inline_keyboard: [[expect.objectContaining({ web_app: { url: "https://sabaq.test/tg/placement?c=quiz-test" } })]] });
  });

  it("asks a stranger for a name and phone and draws questions up to the topic reached", async () => {
    const info = (await api(CHAT.stranger, "placementInfo", { c: "quiz-test" })).body;
    expect(info.center).toEqual({ name: "Test markazi" });
    expect((info.info as { topics: { code: string }[]; known: string | null }).topics.map((t) => t.code)).toEqual(["1", "1.1", "1.2", "2", "2.1", "2.2", "3", "3.1", "9"]);
    expect((info.info as { known: string | null }).known).toBeNull();
    const bad = await api(CHAT.stranger, "placementStart", { c: "quiz-test", topicId: topic["2.1"], firstName: "Vali", lastName: "Yangi", phone: "12" });
    expect(bad.body).toMatchObject({ error: "quizzes.badPhone" });
    const r = await api(CHAT.stranger, "placementStart", { c: "quiz-test", topicId: topic["2.1"], firstName: "Vali", lastName: "Yangi", phone: "+998 91 555 00 99" });
    const v = r.body.attempt as AttemptView;
    attemptId = v.id;
    expect(v).toMatchObject({ kind: "PLACEMENT", state: "open", name: "Vali Yangi" });
    expect(v.questions).toHaveLength(10);
    const att = await db.quizAttempt.findUniqueOrThrow({ where: { id: v.id }, include: { lead: true } });
    const codes = await db.question.findMany({ where: { id: { in: att.questionIds } }, select: { topic: { select: { code: true } } } });
    expect(codes.every((c) => withinReach(c.topic.code, "2.1"))).toBe(true);
    expect(att.lead).toMatchObject({ name: "Vali Yangi", phone: "998915550099", source: "Kirish testi", centerId });
    // the same chat opening it again resumes the running attempt
    expect((await api(CHAT.stranger, "placementStart", { c: "quiz-test", topicId: topic["1.1"], firstName: "Vali", lastName: "Yangi", phone: "998915550099" })).body.attempt).toMatchObject({ id: v.id });
  });

  it("on finish the owner gets the result, the person a thank-you without the wrong numbers", async () => {
    const att = await db.quizAttempt.findUniqueOrThrow({ where: { id: attemptId } });
    const qs = await db.question.findMany({ where: { id: { in: att.questionIds } } });
    const key = new Map(qs.map((x) => [x.id, x.answer]));
    // 8 of 10 right: passes at 70%
    for (let i = 0; i < 8; i++) await saveQuizAnswer(attemptId, CHAT.stranger, i, key.get(att.questionIds[i])!);
    const v = (await api(CHAT.stranger, "submit", { attemptId })).body.attempt as AttemptView;
    expect(v.result).toEqual({ correct: 8, total: 10, percent: 80, wrong: null });
    const note = await db.notification.findFirstOrThrow({ where: { dedupeKey: `quizres:${attemptId}:${CHAT.owner}` } });
    expect(note.text).toContain("Vali Yangi");
    expect(note.text).toContain("8/10");
    expect(await db.notification.count({ where: { dedupeKey: { startsWith: `quizres:${attemptId}:` } } })).toBe(1);
  });

  it("suggests the group at the reached topic; only the owner's press enrolls, as TRIAL", async () => {
    const ctx = await ctxOf(ownerId);
    const { rows } = await placementResults(ctx);
    const row = rows.find((r) => r.id === attemptId)!;
    expect(row).toMatchObject({ passed: true, correct: 8, suggestedGroupId: midGroupId, placedGroup: null });
    expect(await db.enrollment.count({ where: { groupId: midGroupId } })).toBe(0);
    await placeAttempt(ctx, attemptId, midGroupId);
    const att = await db.quizAttempt.findUniqueOrThrow({ where: { id: attemptId }, include: { lead: true } });
    const e = await db.enrollment.findFirstOrThrow({ where: { groupId: midGroupId }, include: { student: true } });
    expect(e).toMatchObject({ status: "TRIAL", studentId: att.studentId });
    expect(e.student).toMatchObject({ firstName: "Vali", lastName: "Yangi", phone: "998915550099", centerId });
    expect(att.lead).toMatchObject({ studentId: att.studentId, stage: "TRIAL_BOOKED" });
    await expect(placeAttempt(ctx, attemptId, midGroupId)).rejects.toMatchObject({ key: "quizzes.alreadyPlaced" });
  });

  it("one attempt per name in a chat; a second child may take it; a failed one is pointed at an earlier group", async () => {
    await expect(startPlacement(centerId, CHAT.stranger, { topicId: topic["2.1"], firstName: "vali", lastName: "yangi", phone: "998915550099" })).rejects.toMatchObject({ key: "quizzes.placementDone" });
    const v = await startPlacement(centerId, CHAT.stranger, { topicId: topic["2.2"], firstName: "Sardor", lastName: "Yangi", phone: "998915550099" });
    await submitQuizAttempt(v.id, CHAT.stranger);
    const row = (await placementResults(await ctxOf(ownerId))).rows.find((r) => r.id === v.id)!;
    expect(row).toMatchObject({ passed: false, correct: 0, suggestedGroupId: midGroupId });
    // the same phone joined the same lead
    expect(await db.lead.count({ where: { centerId, phone: "998915550099" } })).toBe(1);
  });

  it("is closed when the owner switches it off", async () => {
    await savePlacement(await ctxOf(ownerId), { count: 10, passPercent: 70, minutes: 20, open: false });
    expect(await placementInfo(centerId, CHAT.stranger)).toBeNull();
    expect((await api(CHAT.stranger, "placementInfo", { c: "quiz-test" })).body).toMatchObject({ closed: true });
  });
});
