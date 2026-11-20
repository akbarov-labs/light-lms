// Homework (pilot) end to end: the key on the lesson, who is told (by school grade), answering in the
// real bot routing with Telegram replaced by a recorder, the per-question report, the deadline.
// Run: npm run test:integration
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import type { Bot } from "grammy";
import type { Update } from "grammy/types";
import { db } from "@/lib/db";
import { addDays, fromISODate, todayISO } from "@/lib/dates";
import { buildCtx, loadUser } from "@/lib/ctx-core";
import { UserError } from "@/lib/user-error";
import { answerSheet, checkSubmission, deleteHomework, homeworkJob, lessonHomework, openHomeworkFor, saveAnswer, saveHomework, startAnswering } from "@/lib/services/homework";
import { linkChat } from "@/worker/bot/data";
import { createBot } from "@/worker/bot";
import { B } from "@/worker/bot/texts";
import { resetHomeworkTyping, setHomeworkPhotoDeps } from "@/worker/bot/homework";
import type { CreateMessage } from "@/lib/agent/loop";

const today = todayISO();
const CHAT = { ali: 940000001, aliParent: 940000002, layloParent: 940000003, boburParent: 940000004, teacher: 940000005, dilshod: 940000006 };
const PHONE = { ali: "998937770101", aliParent: "998937770102", layloParent: "998937770103", boburParent: "998937770104", teacher: "998937770105", other: "998937770106", dilshod: "998937770107", dilshodParent: "998937770108" };
/** the settings before the pilot center's rules (deadline at the lesson start, no late answers) */
const PLAIN = { dueMinutesBefore: 0, lateDays: 0 };

let bot: Bot;
let calls: { method: string; payload: Record<string, unknown> }[] = [];
let update = 1;
let centerId = "";
let teacherId = "";
let otherTeacherId = "";
let lessonPast = "";
let lessonNext = "";
let lessonLater = "";
let groupId = "";
let branchId = "";
const sid = { ali: "", laylo: "", bobur: "" };

const ctxOf = async (userId: string) => buildCtx((await loadUser(userId))!);

function from(id: number) {
  return { id, is_bot: false, first_name: "T", language_code: "uz" };
}
const chat = (id: number) => ({ id, type: "private", first_name: "T" });
const text = (user: number, t: string): Update =>
  ({ update_id: update++, message: { message_id: update, date: 0, chat: chat(user), from: from(user), text: t } }) as unknown as Update;
const command = (user: number, cmd: string): Update =>
  ({ update_id: update++, message: { message_id: update, date: 0, chat: chat(user), from: from(user), text: `/${cmd}`, entities: [{ type: "bot_command", offset: 0, length: cmd.length + 1 }] } }) as unknown as Update;
const callback = (user: number, data: string): Update =>
  ({ update_id: update++, callback_query: { id: String(update), from: from(user), chat_instance: "1", data, message: { message_id: 77, date: 0, chat: chat(user), text: "x" } } }) as unknown as Update;

async function send(u: Update) {
  calls = [];
  await bot.handleUpdate(u);
  return calls;
}
type Btn = { text: string; callback_data?: string };
const markup = (c: { payload: Record<string, unknown> }) => c.payload.reply_markup as { keyboard?: Btn[][]; inline_keyboard?: Btn[][] } | undefined;
const buttons = (c: { payload: Record<string, unknown> }) => (markup(c)?.inline_keyboard ?? markup(c)?.keyboard ?? []).flat();
/** the last message sent or edited */
const shown = () => calls.filter((c) => c.method === "sendMessage" || c.method === "editMessageText").at(-1)!;
const answerText = () => calls.find((c) => c.method === "answerCallbackQuery")?.payload.text;

beforeAll(async () => {
  const c = await db.center.create({ data: { name: "Uy vazifa markazi", slug: "homework-test", settings: { homework: { enabled: true, directFromGrade: 9 } } } });
  centerId = c.id;
  const branch = await db.branch.create({ data: { centerId, name: "Chilonzor" } });
  const hash = await bcrypt.hash("x-password-1", 4);
  teacherId = (await db.user.create({ data: { centerId, phone: PHONE.teacher, name: "Sardor Ustoz", passwordHash: hash, role: "TEACHER", isTeacher: true, perms: [] } })).id;
  otherTeacherId = (await db.user.create({ data: { centerId, phone: PHONE.other, name: "Boshqa Ustoz", passwordHash: hash, role: "TEACHER", isTeacher: true, perms: [] } })).id;
  const course = await db.course.create({ data: { centerId, name: "Matematika", pricingType: "SUBSCRIPTION", price: 400_000 } });
  const group = await db.group.create({ data: { centerId, branchId: branch.id, courseId: course.id, teacherId, code: 1, name: "Matematika 9", startDate: fromISODate(addDays(today, -40)) } });
  groupId = group.id;
  branchId = branch.id;
  const lesson = (date: string) => db.lesson.create({ data: { groupId: group.id, date: fromISODate(date), startTime: "15:00", endTime: "16:30", teacherId } });
  lessonPast = (await lesson(addDays(today, -1))).id;
  lessonNext = (await lesson(addDays(today, 1))).id;
  lessonLater = (await lesson(addDays(today, 3))).id;

  const start = fromISODate(addDays(today, -30));
  const family = async (name: string, guardianPhone: string) => {
    const f = await db.family.create({ data: { centerId, name } });
    await db.guardian.create({ data: { familyId: f.id, name: `${name} ota-onasi`, phone: guardianPhone, isPrimary: true } });
    return f.id;
  };
  const student = async (familyId: string, firstName: string, lastName: string, schoolGrade: number | null, phone: string | null) => {
    const s = await db.student.create({ data: { centerId, familyId, branchId: branch.id, firstName, lastName, schoolGrade, phone } });
    await db.enrollment.create({ data: { studentId: s.id, groupId: group.id, startDate: start, activatedAt: start, status: "ACTIVE" } });
    return s.id;
  };
  // Ali: 10th grade, his own Telegram → told directly (his parent is not)
  sid.ali = await student(await family("Karimovlar", PHONE.aliParent), "Ali", "Karimov", 10, PHONE.ali);
  // Laylo: 5th grade → her parent
  sid.laylo = await student(await family("Usmonovlar", PHONE.layloParent), "Laylo", "Usmonova", 5, null);
  // Bobur: 10th grade but no Telegram of his own → his parent instead
  sid.bobur = await student(await family("Toshmatovlar", PHONE.boburParent), "Bobur", "Toshmatov", 10, null);
  await linkChat(String(CHAT.ali), PHONE.ali, "uz");
  await linkChat(String(CHAT.aliParent), PHONE.aliParent, "uz");
  await linkChat(String(CHAT.layloParent), PHONE.layloParent, "uz");
  await linkChat(String(CHAT.boburParent), PHONE.boburParent, "uz");
  await linkChat(String(CHAT.teacher), PHONE.teacher, "uz");

  bot = createBot("123:test");
  bot.botInfo = { id: 1, is_bot: true, first_name: "LMS", username: "lms_test_bot", can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false } as Bot["botInfo"];
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    const result = method === "sendMessage" || method === "editMessageText" ? { message_id: 1, date: 0, chat: { id: 1, type: "private" }, text: "" } : true;
    return { ok: true, result } as never;
  });
});

beforeEach(() => {
  calls = [];
});

let homeworkId = "";

describe("the teacher's key", () => {
  it("is refused with the position of a skipped question number", async () => {
    const ctx = await ctxOf(teacherId);
    const err = await saveHomework(ctx, { lessonId: lessonPast, key: "1) B 3) C" }).catch((e) => e);
    expect(err).toBeInstanceOf(UserError);
    expect(err).toMatchObject({ key: "homework.keyNumbering", vars: { n: 2, token: "3) C" } });
  });

  it("belongs to the lesson's own teacher only", async () => {
    const err = await saveHomework(await ctxOf(otherTeacherId), { lessonId: lessonPast, key: "B" }).catch((e) => e);
    expect(err).toMatchObject({ key: "error.forbidden" });
  });

  it("first save tells each student or the parents by school grade", async () => {
    const r = await saveHomework(await ctxOf(teacherId), { lessonId: lessonPast, key: "1) B\n2) -4\n3) 3/4", note: "Darslik 45-bet" });
    expect(r).toMatchObject({ created: true, questions: 3, notified: 3 });
    const hw = await db.homework.findUniqueOrThrow({ where: { lessonId: lessonPast } });
    homeworkId = hw.id;
    expect(hw.answers).toEqual(["B", "-4", "3/4"]);
    const sent = await db.notification.findMany({ where: { dedupeKey: { startsWith: `hw:${hw.id}:` } } });
    const byChat = new Map(sent.map((n) => [n.chatId, n.text]));
    expect([...byChat.keys()].sort()).toEqual([String(CHAT.ali), String(CHAT.layloParent), String(CHAT.boburParent)].sort());
    // the parent hears whose homework it is; the student does not need his own name
    expect(byChat.get(String(CHAT.layloParent))).toContain("Usmonova Laylo");
    expect(byChat.get(String(CHAT.ali))).not.toContain("Karimov Ali");
    expect(byChat.get(String(CHAT.ali))).toContain("Darslik 45-bet");
    expect(byChat.get(String(CHAT.ali))).toContain(B.homeworkBtn.uz);
  });

  it("a correction re-grades and tells nobody again", async () => {
    const r = await saveHomework(await ctxOf(teacherId), { lessonId: lessonPast, key: "B -4 0.75", note: "Darslik 45-bet" });
    expect(r).toMatchObject({ created: false, questions: 3, notified: 0 });
    expect(await db.notification.count({ where: { dedupeKey: { startsWith: `hw:${homeworkId}:` } } })).toBe(3);
  });

  it("typed ahead of a lesson, the notice waits for the lesson's end", async () => {
    await saveHomework(await ctxOf(teacherId), { lessonId: lessonNext, key: "A" });
    const hw = await db.homework.findUniqueOrThrow({ where: { lessonId: lessonNext } });
    const n = await db.notification.findFirstOrThrow({ where: { dedupeKey: { startsWith: `hw:${hw.id}:` } } });
    expect(n.nextAttemptAt.toISOString()).toBe(new Date(`${addDays(today, 1)}T16:30:00+05:00`).toISOString());
    // not open to students yet
    expect((await openHomeworkFor([{ id: sid.ali, firstName: "Ali", lastName: "Karimov" }])).map((h) => h.homeworkId)).toEqual([homeworkId]);
    // deleting it before the lesson ends: the notice is never sent
    await deleteHomework(await ctxOf(teacherId), hw.id);
    expect(await db.notification.count({ where: { dedupeKey: { startsWith: `hw:${hw.id}:` } } })).toBe(0);
  });

  it("is refused while the center has homework off", async () => {
    await db.center.update({ where: { id: centerId }, data: { settings: { homework: { enabled: false } } } });
    const err = await saveHomework(await ctxOf(teacherId), { lessonId: lessonLater, key: "A" }).catch((e) => e);
    await db.center.update({ where: { id: centerId }, data: { settings: { homework: { enabled: true, directFromGrade: 9 } } } });
    expect(err).toMatchObject({ key: "homework.disabled" });
  });
});

describe("answering in the bot", () => {
  beforeEach(() => resetHomeworkTyping());

  it("family menus get the homework button", async () => {
    await send(command(CHAT.ali, "start"));
    expect(buttons(shown()).map((b) => b.text)).toContain(B.homeworkBtn.uz);
  });

  it("a student answers: letters by button, numbers typed, a summary at the end", async () => {
    await send(text(CHAT.ali, B.homeworkBtn.uz));
    const open = buttons(shown()).find((b) => b.callback_data?.startsWith("hw:o:"))!;
    expect(open.callback_data).toBe(`hw:o:${homeworkId}:${sid.ali}`);

    await send(callback(CHAT.ali, open.callback_data!));
    expect(shown().payload.text).toContain("1-savol (1/3)");
    expect(shown().payload.text).toContain("Darslik 45-bet");
    const letters = buttons(shown()).filter((b) => b.callback_data?.startsWith("hw:a:"));
    expect(letters.map((b) => b.text)).toEqual(["A", "B", "C", "D"]);

    // a number typed for a letter question is refused, the question stays
    await send(text(CHAT.ali, "5"));
    expect(shown().payload.text).toBe(B.hwBadLetter.uz.replace("{letters}", "A, B, C, D"));

    await send(callback(CHAT.ali, letters[1].callback_data!));
    expect(answerText()).toBe("1) B");
    expect(shown().method).toBe("editMessageText");
    expect(shown().payload.text).toContain("2-savol (2/3)");
    expect(shown().payload.text).toContain(B.hwTypeNumber.uz);

    await send(text(CHAT.ali, "x = −4"));
    expect(shown().payload.text).toContain("3-savol (3/3)");
    await send(text(CHAT.ali, "javob uchdan to'rt"));
    expect(shown().payload.text).toBe(B.hwBadNumber.uz);
    await send(text(CHAT.ali, "3/4"));
    expect(shown().payload.text).toContain("Javoblaringiz (3/3)");
    expect(shown().payload.text).toContain("1) <b>B</b>   2) <b>-4</b>   3) <b>3/4</b>");
    // no grade is shown until the student asks for a check
    expect(shown().payload.text).not.toContain("Natija");
    expect(buttons(shown()).map((b) => b.text)).toContain(B.hwCheckBtn.uz.replace("{left}", "3"));

    const sub = await db.homeworkSubmission.findUniqueOrThrow({ where: { homeworkId_studentId: { homeworkId, studentId: sid.ali } } });
    expect(sub.answers).toEqual(["B", "-4", "3/4"]);
    expect(sub.chatId).toBe(String(CHAT.ali));
  });

  it("an answer can be changed from the summary", async () => {
    const sub = await db.homeworkSubmission.findUniqueOrThrow({ where: { homeworkId_studentId: { homeworkId, studentId: sid.ali } } });
    await send(callback(CHAT.ali, `hw:g:${sub.id}:0`));
    expect(buttons(shown()).find((b) => b.callback_data === `hw:a:${sub.id}:0:B`)?.text).toBe("✓ B");
    await send(callback(CHAT.ali, `hw:a:${sub.id}:0:C`));
    expect((await db.homeworkSubmission.findUniqueOrThrow({ where: { id: sub.id } })).answers).toEqual(["C", "-4", "3/4"]);
    await send(callback(CHAT.ali, `hw:a:${sub.id}:0:B`));
  });

  it("a parent answers for a younger child", async () => {
    await send(text(CHAT.layloParent, B.homeworkBtn.uz));
    expect(shown().payload.text).toContain("Usmonova Laylo");
    const open = buttons(shown()).find((b) => b.callback_data?.startsWith("hw:o:"))!;
    expect(open.callback_data).toBe(`hw:o:${homeworkId}:${sid.laylo}`);
    await send(callback(CHAT.layloParent, open.callback_data!));
    const sub = await db.homeworkSubmission.findUniqueOrThrow({ where: { homeworkId_studentId: { homeworkId, studentId: sid.laylo } } });
    await send(callback(CHAT.layloParent, `hw:a:${sub.id}:0:B`));
    await send(text(CHAT.layloParent, "4"));
    // skips question 3
    await send(callback(CHAT.layloParent, `hw:s:${sub.id}`));
    expect(shown().payload.text).toContain("Javoblaringiz (2/3)");
  });

  it("nobody answers for a student who is not theirs", async () => {
    await send(callback(CHAT.ali, `hw:o:${homeworkId}:${sid.laylo}`));
    expect(answerText()).toBe(B.forbidden.uz);
    const layloSub = await db.homeworkSubmission.findUniqueOrThrow({ where: { homeworkId_studentId: { homeworkId, studentId: sid.laylo } } });
    await send(callback(CHAT.ali, `hw:a:${layloSub.id}:2:A`));
    expect(answerText()).toBe(B.forbidden.uz);
    expect((await db.homeworkSubmission.findUniqueOrThrow({ where: { id: layloSub.id } })).answers[2]).toBe("");
    // Ali's own parent was not told (Ali hears it himself) but may still see it
    await send(text(CHAT.aliParent, B.homeworkBtn.uz));
    expect(buttons(shown()).map((b) => b.callback_data)).toEqual([`hw:o:${homeworkId}:${sid.ali}`]);
  });

  it("closes at the next lesson's start", async () => {
    const afterDue = new Date(`${addDays(today, 1)}T15:00:00+05:00`);
    const layloSub = await db.homeworkSubmission.findUniqueOrThrow({ where: { homeworkId_studentId: { homeworkId, studentId: sid.laylo } } });
    expect(await saveAnswer(layloSub.id, 2, "3/4", String(CHAT.layloParent), afterDue)).toEqual({ ok: false, reason: "closed" });
    expect(await startAnswering(homeworkId, sid.bobur, String(CHAT.boburParent), afterDue)).toBe("closed");
    expect(await openHomeworkFor([{ id: sid.bobur, firstName: "Bobur", lastName: "Toshmatov" }], afterDue)).toEqual([]);
    // a minute before, still open
    expect(await saveAnswer(layloSub.id, 2, "0,5", String(CHAT.layloParent), new Date(afterDue.getTime() - 60_000))).toMatchObject({ ok: true });
  });
});

describe("results at the next lesson", () => {
  it("per question in order, wrong answers grouped, who did not answer", async () => {
    const next = await db.lesson.findUniqueOrThrow({ where: { id: lessonNext } });
    const { due, set } = await lessonHomework(next, PLAIN);
    expect(set).toBeNull();
    expect(due?.id).toBe(homeworkId);
    const r = due!.report;
    expect(r.answeredBy.sort()).toEqual([sid.ali, sid.laylo].sort());
    expect(r.questions.map((q) => [q.n, q.correct, q.of, q.allCorrect])).toEqual([
      [1, 2, 2, true],
      [2, 1, 2, false],
      [3, 1, 2, false],
    ]);
    expect(r.questions[1].wrong).toEqual([{ given: "4", studentIds: [sid.laylo] }]);
    expect(r.questions[2].wrong).toEqual([{ given: "0.5", studentIds: [sid.laylo] }]);
    expect(r.scores.get(sid.ali)).toEqual({ correct: 3, answered: 3 });
    expect(due!.students.map((s) => s.name)).toEqual(["Karimov Ali", "Toshmatov Bobur", "Usmonova Laylo"]);
    expect(due!.state).toBe("open");
  });

  it("the lesson it was set at shows it as its own, a later lesson shows the latest earlier homework", async () => {
    const past = await db.lesson.findUniqueOrThrow({ where: { id: lessonPast } });
    expect((await lessonHomework(past, PLAIN)).set?.id).toBe(homeworkId);
    // the next lesson has no homework of its own (deleted above): lessonLater's due is still the past one
    const later = await db.lesson.findUniqueOrThrow({ where: { id: lessonLater } });
    expect((await lessonHomework(later, PLAIN)).due?.id).toBe(homeworkId);
  });

  it("a cancelled next lesson moves the deadline to the one after", async () => {
    await db.lesson.update({ where: { id: lessonNext }, data: { status: "CANCELLED" } });
    const past = await db.lesson.findUniqueOrThrow({ where: { id: lessonPast } });
    const { set } = await lessonHomework(past, PLAIN);
    expect(set!.window.dueAt!.toISOString()).toBe(new Date(`${addDays(today, 3)}T15:00:00+05:00`).toISOString());
    await db.lesson.update({ where: { id: lessonNext }, data: { status: "SCHEDULED" } });
  });
});

// ------------------------------------------------------------------ the first pilot center's rules

const PILOT = { enabled: true, directFromGrade: 9, dueMinutesBefore: 60, lateDays: 2, attempts: 3, remindHoursBefore: 3, photos: true };
const RULES = { dueMinutesBefore: 60, lateDays: 2 };
/** tomorrow's lesson starts 15:00: answers close 14:00, late answers until 14:00 two days later */
const at = (day: number, time: string) => new Date(`${addDays(today, day)}T${time}:00+05:00`);
const subOf = (studentId: string) => db.homeworkSubmission.findUniqueOrThrow({ where: { homeworkId_studentId: { homeworkId, studentId } } });

describe("the student's check", () => {
  beforeAll(async () => {
    await db.center.update({ where: { id: centerId }, data: { settings: { homework: PILOT } } });
  });
  beforeEach(() => resetHomeworkTyping());

  it("shows the score and which answers are wrong, with a hint, never the right answer", async () => {
    // Laylo's parent answered B, 4, 0.5 (key: B, -4, 0.75)
    const sub = await subOf(sid.laylo);
    await send(callback(CHAT.layloParent, `hw:c:${sub.id}`));
    expect(answerText()).toBe("Natija: 1/3 to'g'ri");
    const t = String(shown().payload.text);
    expect(t).toContain("❌ Xato: 2, 3");
    expect(t).toContain(B.hwHintSign.uz.replace("{n}", "2"));
    expect(t).not.toContain("-4");
    expect(t).not.toContain("0.75");
    expect(t).toContain(B.hwTryAgain.uz.replace("{left}", "2"));
    expect(buttons(shown()).map((b) => b.text)).toEqual(expect.arrayContaining(["1 🔒", "2 ❌", "3 ❌", B.hwFixBtn.uz, B.hwCheckBtn.uz.replace("{left}", "2")]));
    const row = await subOf(sid.laylo);
    expect(row).toMatchObject({ checks: 1, firstAnswers: ["B", "4", "0.5"], checkedAnswers: ["B", "4", "0.5"] });
  });

  it("a right answer is locked; fixing a wrong one does not reveal it until the next check", async () => {
    const sub = await subOf(sid.laylo);
    await send(callback(CHAT.layloParent, `hw:f:${sub.id}`));
    expect(shown().payload.text).toContain("2-savol (2/3)");
    expect(await saveAnswer(sub.id, 0, "C", String(CHAT.layloParent))).toEqual({ ok: false, reason: "locked" });
    await send(text(CHAT.layloParent, "-4"));
    // straight on to question 3, question 2 is not marked right or locked yet
    expect(shown().payload.text).toContain("3-savol (3/3)");
    expect((await answerSheet(sub.id))!.locked).toEqual([0]);
  });

  it("three checks at most; the class report keeps the first attempt and shows the fixed score beside it", async () => {
    const sub = await subOf(sid.laylo);
    expect(await checkSubmission(sub.id, String(CHAT.layloParent))).toMatchObject({ ok: true, result: { correct: 2 } });
    expect(await checkSubmission(sub.id, String(CHAT.layloParent))).toMatchObject({ ok: true, result: { correct: 2 }, sheet: { checks: 3 } });
    expect(await checkSubmission(sub.id, String(CHAT.layloParent))).toEqual({ ok: false, reason: "done" });
    expect(await saveAnswer(sub.id, 2, "0.75", String(CHAT.layloParent))).toEqual({ ok: false, reason: "done" });
    await send(callback(CHAT.layloParent, `hw:s:${sub.id}`));
    expect(shown().payload.text).toContain(B.hwNoTriesLeft.uz);
    expect(buttons(shown())).toEqual([]);

    const next = await db.lesson.findUniqueOrThrow({ where: { id: lessonNext } });
    const { due } = await lessonHomework(next, RULES);
    expect(due!.report.questions[1].wrong).toEqual([{ given: "4", studentIds: [sid.laylo] }]);
    expect(due!.report.scores.get(sid.laylo)).toEqual({ correct: 1, answered: 3 });
    expect(due!.improved.get(sid.laylo)).toBe(2);
  });

  it("all right: congratulations, and the check can be used no more than allowed", async () => {
    const sub = await subOf(sid.ali);
    await send(callback(CHAT.ali, `hw:c:${sub.id}`));
    expect(answerText()).toBe("Natija: 3/3 to'g'ri");
    expect(shown().payload.text).toContain(B.hwAllRight.uz);
  });
});

describe("reminders, the deadline and late answers", () => {
  it("before the deadline: those with no answer and their parents, once", async () => {
    expect(await homeworkJob(at(1, "10:59"))).toMatchObject({ reminded: 0 });
    const r = await homeworkJob(at(1, "12:00"));
    expect(r.reminded).toBeGreaterThanOrEqual(1);
    const sent = await db.notification.findMany({ where: { dedupeKey: { startsWith: `hwrem:${homeworkId}:` } } });
    // only Bobur has not answered; he has no chat of his own, so his parent
    expect(sent.map((n) => n.chatId)).toEqual([String(CHAT.boburParent)]);
    expect(sent[0].text).toContain("Toshmatov Bobur");
    await homeworkJob(at(1, "13:00"));
    expect(await db.notification.count({ where: { dedupeKey: { startsWith: `hwrem:${homeworkId}:` } } })).toBe(1);
  });

  it("at the deadline the teacher hears who answered and who did not, once", async () => {
    await homeworkJob(at(1, "14:05"));
    await homeworkJob(at(1, "14:10"));
    const sent = await db.notification.findMany({ where: { dedupeKey: { startsWith: `hwdue:${homeworkId}` } } });
    expect(sent.map((n) => n.chatId)).toEqual([String(CHAT.teacher)]);
    expect(sent[0].text).toContain("Javob berdi: 2/3");
    expect(sent[0].text).toContain("Javob bermadi: Toshmatov Bobur");
    // first attempts: Ali 3/3, Laylo 1/3 → 4 of 6
    expect(sent[0].text).toContain("o'rtacha 67%");
  });

  it("whoever answered on time is done at the deadline; who had not may answer late, the teacher is told", async () => {
    const t = at(1, "14:30");
    const laylo = await subOf(sid.laylo);
    expect(await saveAnswer(laylo.id, 2, "0.75", String(CHAT.layloParent), t)).toEqual({ ok: false, reason: "closed" });
    const list = await openHomeworkFor([{ id: sid.bobur, firstName: "Bobur", lastName: "Toshmatov" }], t);
    expect(list).toMatchObject([{ homeworkId, late: true }]);
    const s = await startAnswering(homeworkId, sid.bobur, String(CHAT.boburParent), t);
    expect(s).toMatchObject({ state: "late" });
    const subId = (s as { submissionId: string }).submissionId;
    expect(await saveAnswer(subId, 0, "B", String(CHAT.boburParent), t)).toMatchObject({ ok: true });
    expect(await checkSubmission(subId, String(CHAT.boburParent), t)).toMatchObject({ ok: true, result: { correct: 1 } });
    const notice = await db.notification.findFirstOrThrow({ where: { dedupeKey: `hwlate:${subId}:${CHAT.teacher}` } });
    expect(notice.text).toContain("Kech topshirildi");
    expect(notice.text).toContain("Toshmatov Bobur: 1/3");
    // the class report is the on-time answers; Bobur is listed apart
    const next = await db.lesson.findUniqueOrThrow({ where: { id: lessonNext } });
    const { due } = await lessonHomework(next, RULES, t);
    expect(due!.report.answeredBy.sort()).toEqual([sid.ali, sid.laylo].sort());
    expect(due!.late).toEqual([{ studentId: sid.bobur, name: "Toshmatov Bobur", correct: 1, answered: 1 }]);
    // and after the late days, closed for him too
    expect(await openHomeworkFor([{ id: sid.bobur, firstName: "Bobur", lastName: "Toshmatov" }], at(3, "14:00"))).toEqual([]);
  });
});

describe("answers from a notebook photo", () => {
  let dilshod = "";
  let calls_ = 0;
  const reply = (answers: { n: number; answer: string; sure: boolean }[]): CreateMessage =>
    (async () => {
      calls_++;
      return {
        id: "msg",
        type: "message",
        role: "assistant",
        model: "claude-opus-5-5",
        stop_reason: "end_turn",
        stop_sequence: null,
        content: [{ type: "text", text: JSON.stringify({ answers }) }],
        usage: { input_tokens: 1800, output_tokens: 120, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
      };
    }) as unknown as CreateMessage;
  const photo = (user: number): Update =>
    ({
      update_id: update++,
      message: { message_id: update, date: 0, chat: chat(user), from: from(user), photo: [{ file_id: "small", file_unique_id: "s", width: 90, height: 120 }, { file_id: "big", file_unique_id: "b", width: 960, height: 1280 }] },
    }) as unknown as Update;

  beforeAll(async () => {
    const f = await db.family.create({ data: { centerId, name: "Rahimovlar" } });
    await db.guardian.create({ data: { familyId: f.id, name: "Rahimovlar ota-onasi", phone: PHONE.dilshodParent, isPrimary: true } });
    const s = await db.student.create({ data: { centerId, familyId: f.id, branchId, firstName: "Dilshod", lastName: "Rahimov", schoolGrade: 11, phone: PHONE.dilshod } });
    const start = fromISODate(addDays(today, -30));
    await db.enrollment.create({ data: { studentId: s.id, groupId, startDate: start, activatedAt: start, status: "ACTIVE" } });
    await linkChat(String(CHAT.dilshod), PHONE.dilshod, "uz");
    dilshod = s.id;
  });
  beforeEach(() => resetHomeworkTyping());
  afterAll(() => setHomeworkPhotoDeps(null));

  it("a photo with no homework open asks to open one first", async () => {
    setHomeworkPhotoDeps({ download: async () => ({ data: new Uint8Array([1, 2, 3]), mediaType: "image/jpeg" }), create: reply([]) });
    await send(photo(CHAT.dilshod));
    expect(shown().payload.text).toBe(B.hwPhotoNoSheet.uz);
  });

  it("read, shown for the student to confirm (unsure ones marked), saved only on ✅", async () => {
    let downloaded = "";
    setHomeworkPhotoDeps({
      download: async (_ctx, fileId) => ((downloaded = fileId), { data: new Uint8Array([1, 2, 3]), mediaType: "image/jpeg" }),
      create: reply([
        { n: 1, answer: "B", sure: true },
        { n: 2, answer: "-4", sure: true },
        { n: 3, answer: "0,5", sure: false },
      ]),
    });
    await send(callback(CHAT.dilshod, `hw:o:${homeworkId}:${dilshod}`));
    expect(shown().payload.text).toContain(B.hwPhotoHint.uz);
    await send(photo(CHAT.dilshod));
    expect(downloaded).toBe("big");
    const t = String(shown().payload.text);
    expect(t).toContain("📷 Rasmdan o'qidim (3 ta javob)");
    expect(t).toContain("3) <b>0.5</b> ⚠️");
    const sub = await subOf(dilshod);
    expect(sub.answers.every((a) => a === "")).toBe(true);
    await send(callback(CHAT.dilshod, `hw:p:${sub.id}`));
    expect((await subOf(dilshod)).answers).toEqual(["B", "-4", "0.5"]);
    expect(shown().payload.text).toContain("Javoblaringiz (3/3)");
    // metered as the center's AI use
    const usage = await db.agentUsage.findFirstOrThrow({ where: { centerId } });
    expect(usage.inputTokens).toBeGreaterThanOrEqual(1800);
  });

  it("❌ drops what was read; a right (locked) answer is never replaced by a photo", async () => {
    const sub = await subOf(dilshod);
    expect(await checkSubmission(sub.id, String(CHAT.dilshod))).toMatchObject({ ok: true, result: { correct: 2 } });
    await send(callback(CHAT.dilshod, `hw:s:${sub.id}`));
    setHomeworkPhotoDeps({ download: async () => ({ data: new Uint8Array([1]), mediaType: "image/jpeg" }), create: reply([{ n: 1, answer: "C", sure: true }, { n: 3, answer: "3/4", sure: true }]) });
    await send(photo(CHAT.dilshod));
    expect(shown().payload.text).toContain("📷 Rasmdan o'qidim (1 ta javob)");
    expect(shown().payload.text).not.toContain("1) <b>C</b>");
    await send(callback(CHAT.dilshod, `hw:x:${sub.id}`));
    expect((await subOf(dilshod)).answers).toEqual(["B", "-4", "0.5"]);
    // the same read again, saved this time
    await send(photo(CHAT.dilshod));
    await send(callback(CHAT.dilshod, `hw:p:${sub.id}`));
    expect((await subOf(dilshod)).answers).toEqual(["B", "-4", "3/4"]);
    // a photo of only right answers changes nothing
    setHomeworkPhotoDeps({ download: async () => ({ data: new Uint8Array([1]), mediaType: "image/jpeg" }), create: reply([{ n: 1, answer: "C", sure: true }]) });
    await send(photo(CHAT.dilshod));
    expect(shown().payload.text).toBe(B.hwPhotoAllLocked.uz);
  });

  it("off for the center: no model call", async () => {
    await db.center.update({ where: { id: centerId }, data: { settings: { homework: { ...PILOT, photos: false } } } });
    const before = calls_;
    await send(callback(CHAT.dilshod, `hw:s:${(await subOf(dilshod)).id}`));
    await send(photo(CHAT.dilshod));
    await db.center.update({ where: { id: centerId }, data: { settings: { homework: PILOT } } });
    expect(shown().payload.text).toBe(B.hwPhotoOff.uz);
    expect(calls_).toBe(before);
  });
});
