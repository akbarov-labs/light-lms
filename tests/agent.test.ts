// AI lead agent (src/lib/agent, src/worker/bot/agent.ts) on the real database with a scripted model:
// no API key and no cost. Run: npm run test:integration
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { addDays, fromISODate, monthKey, todayISO } from "@/lib/dates";
import { dbAttemptStore } from "@/lib/auth/attempts-db";
import { attemptKey, recordAttempt } from "@/lib/auth/ratelimit";
import type { CreateMessage } from "@/lib/agent/loop";
import { MARK, activeAgentChat, agentCenterBySlug, handleAgentMessage, openAgentChat, recordPhone } from "@/lib/agent/service";
import { queueTurn } from "@/worker/bot/agent";

type Block = Anthropic.Beta.BetaContentBlock;
const msg = (content: Block[], stop: Anthropic.Beta.BetaMessage["stop_reason"]) =>
  ({ id: "m", type: "message", role: "assistant", model: "test", content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 50 } }) as unknown as Anthropic.Beta.BetaMessage;
const text = (t: string) => ({ type: "text", text: t, citations: null }) as unknown as Block;
const thinking = () => ({ type: "thinking", thinking: "", signature: "sig" }) as unknown as Block;
let n = 0;
const call = (name: string, input: object = {}) => ({ type: "tool_use", id: `toolu_${++n}`, name, input }) as unknown as Block;

/** Scripted model: answers in order, records every request it was sent. */
function model(...answers: Anthropic.Beta.BetaMessage[]) {
  const seen: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming[] = [];
  const create: CreateMessage = async (p) => {
    seen.push(structuredClone(p));
    const a = answers.shift();
    if (!a) throw new Error("scripted model ran out of answers");
    return a;
  };
  return { create, seen, left: () => answers.length };
}
/** Result of the last tool call the model saw in its latest request. */
function lastToolResult(seen: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming[]) {
  const content = seen.at(-1)!.messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[];
  const r = content.at(-1)!;
  return { error: r.is_error ?? false, body: typeof r.content === "string" ? r.content : JSON.stringify(r.content) };
}

const today = todayISO();
const PHONE = "998901234500";
const TEACHER_CHAT = "920000001";
const OWNER_CHAT = "920000002";
let centerId = "";
let groupId = "";
let fullGroupId = "";
let chatSeq = 0;
const newChatId = () => `93000${String(++chatSeq).padStart(4, "0")}`;

beforeAll(async () => {
  const c = await db.center.create({
    data: { name: "Aniq Hisob", slug: "agent-test", phone: "998711234567", settings: { agent: { enabled: true, rules: "Chegirma yo'q. Oyma-oy to'lanadi." } } },
  });
  centerId = c.id;
  const branch = await db.branch.create({ data: { centerId, name: "Chilonzor", address: "Bunyodkor 1" } });
  const hash = await bcrypt.hash("x-password-1", 4);
  const teacher = await db.user.create({ data: { centerId, phone: "998901230001", name: "Ustoz", passwordHash: hash, role: "TEACHER", isTeacher: true, perms: [], telegramChatId: TEACHER_CHAT } });
  await db.user.create({ data: { centerId, phone: "998901230002", name: "Ega", passwordHash: hash, role: "OWNER", perms: [], telegramChatId: OWNER_CHAT } });
  const course = await db.course.create({ data: { centerId, name: "Matematika DTM", pricingType: "SUBSCRIPTION", price: 650_000 } });
  const g = await db.group.create({ data: { centerId, branchId: branch.id, courseId: course.id, teacherId: teacher.id, code: 1, name: "Abituriyentlar", capacity: 10, startDate: fromISODate(addDays(today, -30)) } });
  groupId = g.id;
  await db.groupSlot.create({ data: { groupId, weekday: 1, startTime: "15:00", endTime: "16:30" } });
  for (const d of [1, 3]) await db.lesson.create({ data: { groupId, date: fromISODate(addDays(today, d)), startTime: "15:00", endTime: "16:30", teacherId: teacher.id } });
  const full = await db.group.create({ data: { centerId, branchId: branch.id, courseId: course.id, teacherId: teacher.id, code: 2, name: "To'la guruh", capacity: 1, startDate: fromISODate(addDays(today, -30)) } });
  fullGroupId = full.id;
  await db.lesson.create({ data: { groupId: full.id, date: fromISODate(addDays(today, 2)), startTime: "18:00", endTime: "19:30", teacherId: teacher.id } });
  const fam = await db.family.create({ data: { centerId, name: "Band oila" } });
  const s = await db.student.create({ data: { centerId, familyId: fam.id, branchId: branch.id, firstName: "Band", lastName: "O'quvchi" } });
  await db.enrollment.create({ data: { studentId: s.id, groupId: full.id, startDate: fromISODate(addDays(today, -10)), status: "TRIAL" } });
});

afterEach(() => {
  delete process.env.ANTHROPIC_API_KEY;
});

async function chatFor(chatId = newChatId()) {
  return openAgentChat(centerId, chatId);
}
const turn = (chatRowId: string, t: string, create: CreateMessage) => handleAgentMessage({ chatRowId, text: t, personName: "Sarvar Aliyev", locale: "uz", create });

describe("lead agent: the whole path to a trial lesson", () => {
  it("lists real groups, asks for the phone with a button, books the trial, tells the teacher — and never shows the phone to the model", async () => {
    const chat = await chatFor();
    const m = model(
      msg([thinking(), text("Assalomu alaykum! Kim uchun kurs qidiryapsiz?")], "end_turn"),
      msg([thinking(), call("list_groups", { course: "matem" })], "tool_use"),
      msg([text("Abituriyentlar guruhi bor. Yozilasizmi?")], "end_turn"),
      msg([call("request_phone")], "tool_use"),
      msg([text("Pastdagi tugmani bosing.")], "end_turn"),
      msg([thinking(), call("book_trial", { group_id: groupId, student_first_name: "Sarvar", student_last_name: "Aliyev", for_self: true, goal: "DTM", level_summary: "3/3 to'g'ri" })], "tool_use"),
      msg([call("notify_teacher", { message: "Sarvar, 11-sinf, daraja yuqori." })], "tool_use"),
      msg([text("Yozildingiz! Ertaga soat 15:00, Chilonzor.")], "end_turn"),
    );

    expect((await turn(chat.id, MARK.start, m.create)).replies).toEqual(["Assalomu alaykum! Kim uchun kurs qidiryapsiz?"]);

    await turn(chat.id, "o'zim uchun, 11-sinf, DTM", m.create);
    const groups = JSON.parse(lastToolResult(m.seen).body);
    expect(groups).toEqual([
      expect.objectContaining({ id: groupId, course: "Matematika DTM", price: "650 000 so'm / oy", schedule: "Du 15:00-16:30", branch: "Chilonzor, Bunyodkor 1", seats_left: 10, next_lesson: expect.objectContaining({ days_from_today: 1, time: "15:00" }) }),
      expect.objectContaining({ id: fullGroupId, seats_left: 0 }),
    ]);

    const asked = await turn(chat.id, "ha", m.create);
    expect(asked).toMatchObject({ replies: ["Pastdagi tugmani bosing."], askPhone: true, booked: false });

    await recordPhone((await db.agentChat.findUniqueOrThrow({ where: { id: chat.id } }))!, PHONE, "telegram", "Sarvar Aliyev");
    const lead = await db.lead.findFirstOrThrow({ where: { centerId, phone: PHONE } });
    expect(lead).toMatchObject({ source: "Telegram AI", name: "Sarvar Aliyev", stage: "NEW" });

    const booked = await turn(chat.id, MARK.phone, m.create);
    expect(booked).toMatchObject({ replies: ["Yozildingiz! Ertaga soat 15:00, Chilonzor."], booked: true, askPhone: false });
    expect(m.left()).toBe(0);

    // the trial is a real enrollment, made through the same services as the admin
    const student = await db.student.findFirstOrThrow({ where: { centerId, firstName: "Sarvar" }, include: { family: { include: { guardians: true } }, enrollments: true } });
    expect(student.family.guardians).toEqual([expect.objectContaining({ phone: PHONE, relation: "self" })]);
    expect(student.enrollments).toEqual([expect.objectContaining({ groupId, status: "TRIAL", startDate: fromISODate(addDays(today, 1)) })]);
    const leadAfter = await db.lead.findUniqueOrThrow({ where: { id: lead.id }, include: { notes: true } });
    expect(leadAfter).toMatchObject({ studentId: student.id, stage: "TRIAL_BOOKED" });
    expect(leadAfter.notes.every((x) => x.actor === "AGENT")).toBe(true);
    expect(leadAfter.notes.map((x) => x.text).join("\n")).toContain("Daraja: 3/3 to'g'ri");

    // every audit row of the booking says the agent did it
    const logs = await db.auditLog.findMany({ where: { centerId, entityId: { in: [student.id, lead.id, student.enrollments[0].id] } } });
    expect(logs.length).toBeGreaterThanOrEqual(4);
    expect(new Set(logs.map((l) => l.actor))).toEqual(new Set(["AGENT"]));

    // the teacher got the message (queued), with the phone the model never saw
    const note = await db.notification.findFirstOrThrow({ where: { centerId, chatId: TEACHER_CHAT } });
    expect(note.text).toContain(`+${PHONE}`);
    expect(note.text).toContain(`/leads/${lead.id}`);

    // data minimization: no request to the model contained the phone in any form
    const sent = JSON.stringify(m.seen);
    expect(sent).not.toContain(PHONE);
    expect(sent).not.toContain("901234500");

    // memory: saved without thinking blocks, usage metered per center and month
    const saved = await db.agentChat.findUniqueOrThrow({ where: { id: chat.id } });
    expect(JSON.stringify(saved.messages)).not.toContain('"thinking"');
    const usage = await db.agentUsage.findUniqueOrThrow({ where: { centerId_month: { centerId, month: monthKey(today) } } });
    expect(usage.calls).toBeGreaterThanOrEqual(8);
    expect(saved.inputTokens).toBe(8 * 1000);
  });
});

describe("lead agent: tools refuse what they must", () => {
  it("book_trial and ask_teacher need the phone first", async () => {
    const chat = await chatFor();
    const m = model(msg([call("book_trial", { group_id: groupId, student_first_name: "A", student_last_name: "B", for_self: true, goal: "x", level_summary: "y" })], "tool_use"), msg([text("ok")], "end_turn"));
    await turn(chat.id, "yozing", m.create);
    expect(lastToolResult(m.seen)).toEqual({ error: true, body: expect.stringContaining("request_phone") });
    const m2 = model(msg([call("ask_teacher", { question: "kechki guruh ochiladimi?" })], "tool_use"), msg([text("ok")], "end_turn"));
    await turn(chat.id, "kechki guruh bormi", m2.create);
    expect(lastToolResult(m2.seen)).toEqual({ error: true, body: expect.stringContaining("request_phone") });
  });

  it("a full group is refused with the reason, so the model offers another group", async () => {
    const chat = await chatFor();
    await recordPhone(chat, "998901234501", "telegram", "Ali");
    const m = model(msg([call("book_trial", { group_id: fullGroupId, student_first_name: "Ali", student_last_name: "Valiyev", for_self: true, goal: "x", level_summary: "y" })], "tool_use"), msg([text("boshqa guruh")], "end_turn"));
    await turn(chat.id, "yozing", m.create);
    expect(lastToolResult(m.seen)).toEqual({ error: true, body: expect.stringContaining("to'lgan") });
  });

  it("ask_teacher reaches the owner with the phone, and leaves a note on the lead", async () => {
    const chat = await chatFor();
    await recordPhone(chat, "998901234502", "typed", "Dilshod");
    const m = model(msg([call("ask_teacher", { question: "Shanba kuni kechki guruh ochiladimi?" })], "tool_use"), msg([text("Ustoz siz bilan bog'lanadi")], "end_turn"));
    await turn(chat.id, "shanba kechqurun guruh bormi", m.create);
    expect(JSON.parse(lastToolResult(m.seen).body)).toEqual({ ok: true, delivered: true });
    const n = await db.notification.findFirstOrThrow({ where: { centerId, chatId: OWNER_CHAT, text: { contains: "Shanba" } } });
    expect(n.text).toContain("+998901234502");
    const lead = await db.lead.findFirstOrThrow({ where: { centerId, phone: "998901234502" }, include: { notes: true } });
    expect(lead.notes.map((x) => x.text)).toContain("🤖❓ Shanba kuni kechki guruh ochiladimi?");
  });

  it("a typed (unverified) phone never attaches a child to an existing family's wallet; a Telegram contact does", async () => {
    const fam = await db.family.create({ data: { centerId, name: "Karimovlar" } });
    await db.guardian.create({ data: { familyId: fam.id, name: "Dilshod Karimov", phone: "998901234503", isPrimary: true } });
    const book = (first: string) =>
      model(msg([call("book_trial", { group_id: groupId, student_first_name: first, student_last_name: "Karimov", for_self: false, parent_name: "Dilshod", goal: "x", level_summary: "y" })], "tool_use"), msg([text("ok")], "end_turn"));

    const typed = await chatFor();
    await recordPhone(typed, "998901234503", "typed", "Kimdir");
    await turn(typed.id, "yozing", book("Begona").create);
    expect((await db.student.findFirstOrThrow({ where: { centerId, firstName: "Begona" } })).familyId).not.toBe(fam.id);

    const verified = await chatFor();
    await recordPhone(verified, "998901234503", "telegram", "Dilshod Karimov");
    await turn(verified.id, "yozing", book("Laylo").create);
    expect((await db.student.findFirstOrThrow({ where: { centerId, firstName: "Laylo" } })).familyId).toBe(fam.id);
  });
});

describe("lead agent: switches, limits and memory", () => {
  it("answers only when the key is set and the center switched it on", async () => {
    expect(await agentCenterBySlug("agent-test")).toBeNull(); // no key
    process.env.ANTHROPIC_API_KEY = "test-key";
    expect(await agentCenterBySlug("agent-test")).toMatchObject({ id: centerId });
    expect(await agentCenterBySlug("no-such-center")).toBeNull();
    await db.center.create({ data: { name: "Off", slug: "agent-test-off" } });
    expect(await agentCenterBySlug("agent-test-off")).toBeNull();
  });

  it("stops before calling the model when the center is over its monthly token cap", async () => {
    const other = await db.center.create({ data: { name: "Capped", slug: "agent-test-cap", settings: { agent: { enabled: true, monthlyTokenCap: 1000 } } } });
    await db.agentUsage.create({ data: { centerId: other.id, month: monthKey(today), inputTokens: 900, outputTokens: 100, calls: 3 } });
    const chat = await openAgentChat(other.id, newChatId());
    const m = model();
    const r = await turn(chat.id, "salom", m.create);
    expect(r.replies[0]).toContain("administratori siz bilan bog'lanadi");
    expect(m.seen).toHaveLength(0);
  });

  it("rate-limits a chat that floods the bot, without calling the model", async () => {
    const chat = await chatFor();
    await recordAttempt(dbAttemptStore, Array(20).fill(attemptKey.agentChat(chat.chatId)), false);
    const m = model();
    const r = await turn(chat.id, "salom", m.create);
    expect(r.replies[0]).toContain("Juda ko'p xabar");
    expect(m.seen).toHaveLength(0);
  });

  it("an idle conversation starts over but keeps the phone; a typed phone never replaces a verified one", async () => {
    const chatId = newChatId();
    const chat = await openAgentChat(centerId, chatId);
    await recordPhone(chat, "998901234504", "telegram", "X");
    await db.agentChat.update({ where: { id: chat.id }, data: { messages: [{ role: "user", content: "eski" }], lastMessageAt: new Date(Date.now() - 8 * 86_400_000) } });
    expect(await activeAgentChat(chatId)).toBeNull();
    const reopened = await openAgentChat(centerId, chatId);
    expect(reopened).toMatchObject({ messages: [], phone: "998901234504" });
    await recordPhone(reopened, "998909999999", "typed", "X");
    expect((await db.agentChat.findUniqueOrThrow({ where: { id: chat.id } })).phone).toBe("998901234504");
  });

  it("queues a chat's turns: messages sent while a turn runs are merged into the next one", async () => {
    const ran: string[] = [];
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const first = queueTurn("q1", "a", async (t) => {
      ran.push(t);
      if (t === "a") await gate;
    });
    await queueTurn("q1", "b", async () => void ran.push("should not run separately"));
    await queueTurn("q1", "c", async () => void ran.push("should not run separately"));
    release();
    await first;
    expect(ran).toEqual(["a", "b\nc"]);
  });
});
