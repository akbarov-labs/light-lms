// Math tutor end to end: the real bot routing with Telegram replaced by a recorder and the model call by a
// scripted function (no API cost). Enabled vs disabled, the daily limit and the monthly cap, an open
// homework sheet keeping its flow, a pasted sheet refused, a reply that leaks an open homework key replaced.
// Run: npm run test:integration
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import type { Bot } from "grammy";
import type { Update } from "grammy/types";
import { db } from "@/lib/db";
import { addDays, fromISODate, monthKey, todayISO } from "@/lib/dates";
import { linkChat } from "@/worker/bot/data";
import { createBot } from "@/worker/bot";
import { B } from "@/worker/bot/texts";
import { resetHomeworkTyping } from "@/worker/bot/homework";
import { tutorSettled } from "@/worker/bot/tutor";
import { handleTutorMessage, openKeysFor, setTutorModel, tutorFor } from "@/lib/tutor/service";
import { TUTOR_SYSTEM } from "@/lib/tutor/prompt";
import { makeT } from "@/lib/i18n";
import type { CreateMessage } from "@/lib/agent/loop";

const t = makeT("uz");
const today = todayISO();
const CHAT = { ali: 960000001, layloParent: 960000002, bobur: 960000003, stranger: 960000004 };
const PHONE = { ali: "998937790101", layloParent: "998937790102", bobur: "998937790103", teacher: "998937790104", teacherB: "998937790105" };

let bot: Bot;
let calls: { method: string; payload: Record<string, unknown> }[] = [];
let update = 1;
let centerId = "";
let homeworkId = "";
const sid = { ali: "", laylo: "", bobur: "" };

// ------------------------------------------------------------------ the scripted model
let script: string[] = [];
let refuse = false;
let params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming[] = [];
const model: CreateMessage = async (p) => {
  params.push(p);
  const text = script.shift() ?? "Qaysi qadamda qiynalyapsiz?";
  return {
    id: "msg",
    type: "message",
    role: "assistant",
    model: p.model,
    stop_reason: refuse ? "refusal" : "end_turn",
    stop_sequence: null,
    content: refuse ? [] : [{ type: "text", text }],
    usage: { input_tokens: 1000, output_tokens: 100, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
  } as unknown as Anthropic.Beta.BetaMessage;
};

// ------------------------------------------------------------------ Telegram
const from = (id: number) => ({ id, is_bot: false, first_name: "T", language_code: "uz" });
const chat = (id: number) => ({ id, type: "private", first_name: "T" });
const text = (user: number, s: string): Update =>
  ({ update_id: update++, message: { message_id: update, date: 0, chat: chat(user), from: from(user), text: s } }) as unknown as Update;
const command = (user: number, cmd: string): Update =>
  ({ update_id: update++, message: { message_id: update, date: 0, chat: chat(user), from: from(user), text: `/${cmd}`, entities: [{ type: "bot_command", offset: 0, length: cmd.length + 1 }] } }) as unknown as Update;
const callback = (user: number, data: string): Update =>
  ({ update_id: update++, callback_query: { id: String(update), from: from(user), chat_instance: "1", data, message: { message_id: 77, date: 0, chat: chat(user), text: "x" } } }) as unknown as Update;
const photo = (user: number): Update =>
  ({ update_id: update++, message: { message_id: update, date: 0, chat: chat(user), from: from(user), photo: [{ file_id: "f1", file_unique_id: "u1", width: 10, height: 10 }] } }) as unknown as Update;

/** Send an update and wait for the tutor's background turn. */
async function send(u: Update) {
  calls = [];
  await bot.handleUpdate(u);
  await tutorSettled();
  return calls;
}
const sent = () => calls.filter((c) => c.method === "sendMessage" || c.method === "editMessageText");
const last = () => sent().at(-1)!;
type Btn = { text: string };
const keyboard = (c: { payload: Record<string, unknown> }) => ((c.payload.reply_markup as { keyboard?: Btn[][] } | undefined)?.keyboard ?? []).flat().map((b) => b.text);

const savedKey = process.env.ANTHROPIC_API_KEY;

beforeAll(async () => {
  // never a real model call from tests: no key, and the scripted model wherever the tutor runs
  delete process.env.ANTHROPIC_API_KEY;
  setTutorModel(model);

  const c = await db.center.create({ data: { name: "Tutor markazi", slug: "tutor-test", settings: { homework: { enabled: true }, tutor: { enabled: true } } } });
  centerId = c.id;
  const off = await db.center.create({ data: { name: "Tutorsiz markaz", slug: "tutor-off-test", settings: { homework: { enabled: true } } } });

  const setup = async (cid: string, teacherPhone: string) => {
    const branch = await db.branch.create({ data: { centerId: cid, name: "Markaz" } });
    const teacher = await db.user.create({ data: { centerId: cid, phone: teacherPhone, name: "Ustoz", passwordHash: "x", role: "TEACHER", isTeacher: true, perms: [] } });
    const course = await db.course.create({ data: { centerId: cid, name: "Matematika", pricingType: "SUBSCRIPTION", price: 400_000 } });
    const group = await db.group.create({ data: { centerId: cid, branchId: branch.id, courseId: course.id, teacherId: teacher.id, code: 1, name: "Matematika 9", startDate: fromISODate(addDays(today, -40)) } });
    const lesson = (date: string) => db.lesson.create({ data: { groupId: group.id, date: fromISODate(date), startTime: "15:00", endTime: "16:30", teacherId: teacher.id } });
    const past = await lesson(addDays(today, -1));
    await lesson(addDays(today, 1));
    const start = fromISODate(addDays(today, -30));
    const student = async (name: string, grade: number, phone: string | null, guardianPhone: string | null) => {
      const f = await db.family.create({ data: { centerId: cid, name } });
      if (guardianPhone) await db.guardian.create({ data: { familyId: f.id, name: `${name} ota-onasi`, phone: guardianPhone, isPrimary: true } });
      const s = await db.student.create({ data: { centerId: cid, familyId: f.id, branchId: branch.id, firstName: name, lastName: "T", schoolGrade: grade, phone } });
      await db.enrollment.create({ data: { studentId: s.id, groupId: group.id, startDate: start, activatedAt: start, status: "ACTIVE" } });
      return s.id;
    };
    return { group, past, student };
  };

  const a = await setup(centerId, PHONE.teacher);
  sid.ali = await a.student("Ali", 10, PHONE.ali, null);
  sid.laylo = await a.student("Laylo", 5, null, PHONE.layloParent);
  // the open homework of the group: 1) B 2) -4 3) 12
  homeworkId = (await db.homework.create({ data: { centerId, groupId: a.group.id, lessonId: a.past.id, answers: ["B", "-4", "12"] } })).id;

  const b = await setup(off.id, PHONE.teacherB);
  sid.bobur = await b.student("Bobur", 10, PHONE.bobur, null);

  await linkChat(String(CHAT.ali), PHONE.ali, "uz");
  await linkChat(String(CHAT.layloParent), PHONE.layloParent, "uz");
  await linkChat(String(CHAT.bobur), PHONE.bobur, "uz");

  bot = createBot("123:test");
  bot.botInfo = { id: 1, is_bot: true, first_name: "LMS", username: "lms_test_bot", can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false } as Bot["botInfo"];
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ method, payload: payload as Record<string, unknown> });
    const result = method === "sendMessage" || method === "editMessageText" ? { message_id: 1, date: 0, chat: { id: 1, type: "private" }, text: "" } : true;
    return { ok: true, result } as never;
  });
});

afterAll(() => {
  setTutorModel(null);
  if (savedKey !== undefined) process.env.ANTHROPIC_API_KEY = savedKey;
});

beforeEach(async () => {
  calls = [];
  script = [];
  refuse = false;
  params = [];
  resetHomeworkTyping();
});

describe("who gets the tutor", () => {
  it("a linked student of a center with the tutor on: the button in the menu, and its explanation", async () => {
    await send(command(CHAT.ali, "start"));
    expect(keyboard(last())).toContain(B.tutorBtn.uz);
    await send(text(CHAT.ali, B.tutorBtn.uz));
    expect(last().payload.text).toBe(t("tutor.intro", { n: 30 }));
    expect(last().payload.parse_mode).toBe("HTML");
    expect(params).toHaveLength(0);
  });

  it("a center with the tutor off keeps today's behavior: no button, free text gets the menu reply", async () => {
    await send(command(CHAT.bobur, "start"));
    expect(keyboard(last())).not.toContain(B.tutorBtn.uz);
    await send(text(CHAT.bobur, "2x + 3 = 11 ni qanday yechaman?"));
    expect(last().payload.text).toBe(B.notLinked.uz);
    expect(params).toHaveLength(0);
    expect(await db.tutorChat.count({ where: { chatId: String(CHAT.bobur) } })).toBe(0);
  });

  it("a chat linked to nobody is not the tutor's", async () => {
    await send(text(CHAT.stranger, "2x + 3 = 11 ni qanday yechaman?"));
    expect(last().payload.text).toBe(B.notLinked.uz);
    expect(params).toHaveLength(0);
  });

  it("no model reachable (no API key, no test model): off for everyone", async () => {
    setTutorModel(null);
    try {
      expect(await tutorFor(String(CHAT.ali))).toBeNull();
      await send(text(CHAT.ali, "2x + 3 = 11 ni qanday yechaman?"));
      expect(last().payload.text).toBe(B.notLinked.uz);
    } finally {
      setTutorModel(model);
    }
  });
});

describe("a turn", () => {
  it("answers a student's question with the model's hint, metered and remembered", async () => {
    script = ["Avval **3** ni o'ng tomonga o'tkazing: 2x = 11 − 3. Endi nima chiqadi?"];
    await send(text(CHAT.ali, "2x + 3 = 11 ni qanday yechaman?"));
    expect(last().payload.text).toBe("Avval <b>3</b> ni o'ng tomonga o'tkazing: 2x = 11 − 3. Endi nima chiqadi?");
    expect(last().payload.parse_mode).toBe("HTML");
    expect(calls.some((c) => c.method === "sendChatAction")).toBe(true);

    const p = params[0];
    expect(p.model).toBe("claude-opus-5-5");
    expect(p.system).toEqual([{ type: "text", text: TUTOR_SYSTEM, cache_control: { type: "ephemeral" } }]);
    expect(p.messages.at(-2)).toEqual({ role: "user", content: "2x + 3 = 11 ni qanday yechaman?" });
    expect(p.messages.at(-1)).toMatchObject({ role: "system" });
    expect(String(p.messages.at(-1)!.content)).toContain("Grade: 10. This chat is the student's own.");

    const usage = await db.agentUsage.findUniqueOrThrow({ where: { centerId_month: { centerId, month: monthKey(today) } } });
    expect(usage).toMatchObject({ inputTokens: 1000, outputTokens: 100, calls: 1 });
    const row = await db.tutorChat.findUniqueOrThrow({ where: { centerId_chatId: { centerId, chatId: String(CHAT.ali) } } });
    expect(row).toMatchObject({ day: today, dayMessages: 1, inputTokens: 1000 });
    expect(row.messages).toHaveLength(2);

    // the next message carries the conversation
    script = ["To'g'ri! Endi ikkala tomonni 2 ga bo'ling."];
    await send(text(CHAT.ali, "2x = 8"));
    expect(params[1].messages.slice(0, 3)).toEqual([
      { role: "user", content: "2x + 3 = 11 ni qanday yechaman?" },
      { role: "assistant", content: "Avval **3** ni o'ng tomonga o'tkazing: 2x = 11 − 3. Endi nima chiqadi?" },
      { role: "user", content: "2x = 8" },
    ]);

    // the conversation log (/conversations): both exchanges, as the student read them, in order
    const log = await db.botMessage.findMany({ where: { centerId, chatId: String(CHAT.ali), kind: "TUTOR" }, orderBy: { createdAt: "asc" } });
    expect(log.map((m) => [m.from, m.text])).toEqual([
      ["PERSON", "2x + 3 = 11 ni qanday yechaman?"],
      ["BOT", "Avval 3 ni o'ng tomonga o'tkazing: 2x = 11 − 3. Endi nima chiqadi?"],
      ["PERSON", "2x = 8"],
      ["BOT", "To'g'ri! Endi ikkala tomonni 2 ga bo'ling."],
    ]);
  });

  it("a parent asking for a child: the model hears it is a parent and the child's grade", async () => {
    await send(text(CHAT.layloParent, "Kasrlarni qanday qo'shamiz? Qizim 5-sinfda."));
    expect(String(params[0].messages.at(-1)!.content)).toContain("Grade: 5. This chat is a parent's");
    expect(last().payload.text).toBe("Qaysi qadamda qiynalyapsiz?");
  });

  it("a pasted homework sheet is refused by code, no model call", async () => {
    await send(text(CHAT.ali, "1) 2x+3=7\n2) 3x-1=8\n3) x/2=5"));
    expect(last().payload.text).toBe(t("tutor.sheet"));
    expect(params).toHaveLength(0);
  });

  it("a reply that gives away an open homework key is replaced", async () => {
    expect(await openKeysFor([sid.ali])).toEqual([["B", "-4", "12"]]);
    script = ["2-misolning javobi: -4"];
    await send(text(CHAT.ali, "2-misolni tushunmadim"));
    expect(last().payload.text).toBe(t("tutor.leak"));
    const row = await db.tutorChat.findUniqueOrThrow({ where: { centerId_chatId: { centerId, chatId: String(CHAT.ali) } } });
    expect(row.blockedReplies).toBe(1);
    // the model's leaking text is not kept: the next turn sees the refusal
    expect((row.messages as { content: string }[]).at(-1)!.content).toBe(t("tutor.leak"));
    expect(JSON.stringify(row.messages)).not.toContain("javobi: -4");

    // the same final answer, when the student named the question earlier in the conversation
    script = ["Demak, x = -4"];
    await send(text(CHAT.ali, "bilmadim"));
    expect(last().payload.text).toBe(t("tutor.leak"));
  });

  it("a model refusal gets a fixed text and is not remembered", async () => {
    const before = await db.tutorChat.findUniqueOrThrow({ where: { centerId_chatId: { centerId, chatId: String(CHAT.ali) } } });
    refuse = true;
    await send(text(CHAT.ali, "nimadir"));
    expect(last().payload.text).toBe(t("tutor.refused"));
    const after = await db.tutorChat.findUniqueOrThrow({ where: { centerId_chatId: { centerId, chatId: String(CHAT.ali) } } });
    expect(after.messages).toEqual(before.messages);
  });
});

describe("limits", () => {
  it("the chat's daily limit: refused without a model call, a new day starts over", async () => {
    const where = { centerId_chatId: { centerId, chatId: String(CHAT.ali) } };
    await db.tutorChat.update({ where, data: { day: today, dayMessages: 30 } });
    await send(text(CHAT.ali, "Yana bir savol"));
    expect(last().payload.text).toBe(t("tutor.dailyLimit", { n: 30 }));
    expect(params).toHaveLength(0);
    // yesterday's count does not hold today
    await db.tutorChat.update({ where, data: { day: addDays(today, -1), dayMessages: 30 } });
    await send(text(CHAT.ali, "Yana bir savol"));
    expect(params).toHaveLength(1);
    expect((await db.tutorChat.findUniqueOrThrow({ where })).dayMessages).toBe(1);
  });

  it("the center's own daily number from settings", async () => {
    await db.center.update({ where: { id: centerId }, data: { settings: { homework: { enabled: true }, tutor: { enabled: true, dailyMessages: 1 } } } });
    try {
      const r = await handleTutorMessage({ chatId: String(CHAT.ali), text: "Yana", locale: "ru" });
      expect(r.outcome).toBe("limit");
      expect(r.html).toBe(makeT("ru")("tutor.dailyLimit", { n: 1 }));
    } finally {
      await db.center.update({ where: { id: centerId }, data: { settings: { homework: { enabled: true }, tutor: { enabled: true } } } });
    }
  });

  it("the center's monthly token cap, shared with the AI agent", async () => {
    const month = monthKey(today);
    const before = await db.agentUsage.findUniqueOrThrow({ where: { centerId_month: { centerId, month } } });
    await db.agentUsage.update({ where: { centerId_month: { centerId, month } }, data: { inputTokens: 5_000_000 } });
    try {
      await send(text(CHAT.layloParent, "Yana savol"));
      expect(last().payload.text).toBe(t("tutor.paused"));
      expect(params).toHaveLength(0);
    } finally {
      await db.agentUsage.update({ where: { centerId_month: { centerId, month } }, data: { inputTokens: before.inputTokens } });
    }
  });
});

describe("other flows keep going", () => {
  it("an open homework sheet: typed answers go to the sheet, a question gets told to wait", async () => {
    await send(callback(CHAT.ali, `hw:o:${homeworkId}:${sid.ali}`));
    expect(last().payload.text).toContain("1-savol (1/3)");
    // question 1 is a letter: "B" is its answer, not a tutor question
    await send(text(CHAT.ali, "B"));
    expect(last().payload.text).toContain("2-savol (2/3)");
    expect(params).toHaveLength(0);
    const sub = await db.homeworkSubmission.findUniqueOrThrow({ where: { homeworkId_studentId: { homeworkId, studentId: sid.ali } } });
    expect(sub.answers[0]).toBe("B");
    // the summary is shown: still the sheet's time, no tutor
    await send(callback(CHAT.ali, `hw:s:${sub.id}`));
    await send(text(CHAT.ali, "2-misolni qanday yechaman?"));
    expect(last().payload.text).toBe(t("tutor.sheetOpen"));
    expect(params).toHaveLength(0);
  });

  it("a timed test running in the chat: no help until it ends", async () => {
    const quiz = await db.quiz.create({ data: { centerId, title: "Kvadrat tenglamalar", minutes: 20, status: "PUBLISHED" } });
    const attempt = await db.quizAttempt.create({ data: { quizId: quiz.id, studentId: sid.laylo, chatId: String(CHAT.layloParent), questionIds: [], total: 0, deadlineAt: new Date(Date.now() + 10 * 60_000) } });
    await send(text(CHAT.layloParent, "x² − 5x + 6 = 0 ni qanday yechaman?"));
    expect(last().payload.text).toBe(t("tutor.testOpen"));
    expect(params).toHaveLength(0);
    // the time is up: the tutor helps again
    await db.quizAttempt.update({ where: { id: attempt.id }, data: { deadlineAt: new Date(Date.now() - 1000) } });
    await send(text(CHAT.layloParent, "x² − 5x + 6 = 0 ni qanday yechaman?"));
    expect(params).toHaveLength(1);
    await db.quizAttempt.delete({ where: { id: attempt.id } });
    await db.quiz.delete({ where: { id: quiz.id } });
  });

  it("a photo with no sheet open: the tutor reads typed questions only", async () => {
    await send(photo(CHAT.ali));
    expect(last().payload.text).toBe(t("tutor.photo"));
    expect(params).toHaveLength(0);
  });

  it("commands are never the tutor's", async () => {
    await send(command(CHAT.ali, "lang"));
    expect(params).toHaveLength(0);
  });
});
