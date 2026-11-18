// Homework (pilot) end to end: the key on the lesson, who is told (by school grade), answering in the
// real bot routing with Telegram replaced by a recorder, the per-question report, the deadline.
// Run: npm run test:integration
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import type { Bot } from "grammy";
import type { Update } from "grammy/types";
import { db } from "@/lib/db";
import { addDays, fromISODate, todayISO } from "@/lib/dates";
import { buildCtx, loadUser } from "@/lib/ctx-core";
import { UserError } from "@/lib/user-error";
import { deleteHomework, lessonHomework, openHomeworkFor, saveAnswer, saveHomework, startAnswering } from "@/lib/services/homework";
import { linkChat } from "@/worker/bot/data";
import { createBot } from "@/worker/bot";
import { B } from "@/worker/bot/texts";
import { resetHomeworkTyping } from "@/worker/bot/homework";

const today = todayISO();
const CHAT = { ali: 940000001, aliParent: 940000002, layloParent: 940000003, boburParent: 940000004, teacher: 940000005 };
const PHONE = { ali: "998937770101", aliParent: "998937770102", layloParent: "998937770103", boburParent: "998937770104", teacher: "998937770105", other: "998937770106" };

let bot: Bot;
let calls: { method: string; payload: Record<string, unknown> }[] = [];
let update = 1;
let centerId = "";
let teacherId = "";
let otherTeacherId = "";
let lessonPast = "";
let lessonNext = "";
let lessonLater = "";
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
    // no grade is shown to the student
    expect(shown().payload.text).not.toMatch(/to'g'ri|xato/);

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
    const { due, set } = await lessonHomework(next);
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
    expect((await lessonHomework(past)).set?.id).toBe(homeworkId);
    // the next lesson has no homework of its own (deleted above): lessonLater's due is still the past one
    const later = await db.lesson.findUniqueOrThrow({ where: { id: lessonLater } });
    expect((await lessonHomework(later)).due?.id).toBe(homeworkId);
  });

  it("a cancelled next lesson moves the deadline to the one after", async () => {
    await db.lesson.update({ where: { id: lessonNext }, data: { status: "CANCELLED" } });
    const past = await db.lesson.findUniqueOrThrow({ where: { id: lessonPast } });
    const { set } = await lessonHomework(past);
    expect(set!.window.dueAt!.toISOString()).toBe(new Date(`${addDays(today, 3)}T15:00:00+05:00`).toISOString());
    await db.lesson.update({ where: { id: lessonNext }, data: { status: "SCHEDULED" } });
  });
});
