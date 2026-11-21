// AI lead agent (src/lib/agent, src/worker/bot/agent.ts) on the real database with a scripted model:
// no API key and no cost. Run: npm run test:integration
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { addDays, formatDate, fromISODate, monthKey, todayISO } from "@/lib/dates";
import { dbAttemptStore } from "@/lib/auth/attempts-db";
import { attemptKey, recordAttempt } from "@/lib/auth/ratelimit";
import type { CreateMessage } from "@/lib/agent/loop";
import { MARK, activeAgentChat, agentCenterBySlug, agentNotice, answerFromTelegram, capTokens, confirmCancel, handleAgentMessage, openAgentChat, recordPhone, sendStaffMessage } from "@/lib/agent/service";
import { looksLikePhone, queueTurn } from "@/worker/bot/agent";
import { normalizePhone } from "@/lib/phone";
import type { AgentChat } from "@/generated/prisma/client";
import { ownerReport } from "@/worker/jobs";

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
/** The center prompt (top-level system, a cached text block) and the turn's state block (a role:system message). */
type Req = Anthropic.Beta.Messages.MessageCreateParamsNonStreaming;
const centerPrompt = (p: Req) => (p.system as Anthropic.Beta.BetaTextBlockParam[])[0].text;
const statePart = (p: Req) => p.messages.filter((x) => x.role === "system").map((x) => String(x.content)).join("\n");
/** Result of the last tool call the model saw in its latest request. */
function lastToolResult(seen: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming[]) {
  // the last user message; a fresh state block (role:system) follows the tool results
  const content = seen.at(-1)!.messages.filter((m) => m.role === "user").at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[];
  const r = content.at(-1)!;
  return { error: r.is_error ?? false, body: typeof r.content === "string" ? r.content : JSON.stringify(r.content) };
}

const today = todayISO();
const PHONE = "998901234500";
const TEACHER_CHAT = "920000001";
const OWNER_CHAT = "920000002";
let centerId = "";
let branchId = "";
let ownerId = "";
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
  branchId = branch.id;
  const hash = await bcrypt.hash("x-password-1", 4);
  const teacher = await db.user.create({ data: { centerId, phone: "998901230001", name: "Ustoz", passwordHash: hash, role: "TEACHER", isTeacher: true, perms: [], telegramChatId: TEACHER_CHAT } });
  ownerId = (await db.user.create({ data: { centerId, phone: "998901230002", name: "Ega", passwordHash: hash, role: "OWNER", perms: [], telegramChatId: OWNER_CHAT } })).id;
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
// as the bot does: everything but the bare /start event is the person speaking
const turn = (chatRowId: string, t: string, create: CreateMessage) =>
  handleAgentMessage({ chatRowId, text: t, personName: "Sarvar Aliyev", locale: "uz", create, fromPerson: t !== MARK.start });

describe("lead agent: the conversation log", () => {
  it("keeps what the person wrote and everything they saw, staff replies too; /start itself is not the person speaking", async () => {
    const chat = await chatFor();
    const m = model(msg([text("Assalomu alaykum! Qanday yordam beray?")], "end_turn"), msg([text("Oyiga 650 000 so'm.")], "end_turn"));
    await turn(chat.id, MARK.start, m.create);
    await turn(chat.id, "Narxi qancha?", m.create);
    await sendStaffMessage({ centerId, chatRowId: chat.id, userId: ownerId, staffName: "Ega", text: "Chegirma haqida o'zim yozaman." });
    const log = await db.botMessage.findMany({ where: { centerId, chatId: chat.chatId, kind: "AGENT" }, orderBy: { createdAt: "asc" } });
    expect(log.map((x) => [x.from, x.text, x.name])).toEqual([
      ["BOT", "Assalomu alaykum! Qanday yordam beray?", null],
      ["PERSON", "Narxi qancha?", "Sarvar Aliyev"],
      ["BOT", "Oyiga 650 000 so'm.", null],
      ["STAFF", "Chegirma haqida o'zim yozaman.", "Ega"],
    ]);
  });
});

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
    expect((await db.agentChat.findUniqueOrThrow({ where: { id: chat.id } })).leadId).toBeNull(); // opening the bot is not a lead yet

    await turn(chat.id, "o'zim uchun, 11-sinf, DTM", m.create);
    // the first thing the person wrote makes them a lead, before any phone
    const early = await db.lead.findUniqueOrThrow({ where: { id: (await db.agentChat.findUniqueOrThrow({ where: { id: chat.id } })).leadId! } });
    expect(early).toMatchObject({ phone: null, source: "Telegram AI", name: "Sarvar Aliyev", nextContactAt: null });
    const groups = JSON.parse(lastToolResult(m.seen).body);
    expect(groups).toEqual([
      expect.objectContaining({
        id: groupId,
        course: "Matematika DTM",
        price: "650 000 so'm / oy",
        schedule: "Du 15:00-16:30",
        branch: "Chilonzor, Bunyodkor 1",
        group_started_on: formatDate(addDays(today, -30)),
        seats_left: 10,
        next_lessons: [expect.objectContaining({ days_from_today: 1, time: "15:00" }), expect.objectContaining({ days_from_today: 3 })],
      }),
      expect.objectContaining({ id: fullGroupId, seats_left: 0 }),
    ]);

    const asked = await turn(chat.id, "ha", m.create);
    expect(asked).toMatchObject({ replies: ["Pastdagi tugmani bosing."], askPhone: true, booked: false });

    await recordPhone((await db.agentChat.findUniqueOrThrow({ where: { id: chat.id } }))!, PHONE, "telegram", "Sarvar Aliyev");
    const lead = await db.lead.findFirstOrThrow({ where: { centerId, phone: PHONE } });
    expect(lead).toMatchObject({ id: early.id, source: "Telegram AI", name: "Sarvar Aliyev", stage: "NEW", nextContactAt: fromISODate(today) });

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
  it("book_trial needs the phone; ask_teacher does not (the owner answers through the bot)", async () => {
    const chat = await chatFor();
    const m = model(msg([call("book_trial", { group_id: groupId, student_first_name: "A", student_last_name: "B", for_self: true, goal: "x", level_summary: "y" })], "tool_use"), msg([text("ok")], "end_turn"));
    await turn(chat.id, "yozing", m.create);
    expect(lastToolResult(m.seen)).toEqual({ error: true, body: expect.stringContaining("request_phone") });
    const m2 = model(msg([call("ask_teacher", { question: "Yakshanba kechki guruh ochiladimi?" })], "tool_use"), msg([text("ok")], "end_turn"));
    await turn(chat.id, "kechki guruh bormi", m2.create);
    expect(JSON.parse(lastToolResult(m2.seen).body)).toEqual({ ok: true, delivered: true });
    const n = await db.notification.findFirstOrThrow({ where: { centerId, chatId: OWNER_CHAT, text: { contains: "Yakshanba" } } });
    expect(n.text).toContain("raqamsiz");
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

  it("an idle conversation is reopened, not erased: the model is told how long it was away; a typed phone never replaces a verified one", async () => {
    const chatId = newChatId();
    const chat = await openAgentChat(centerId, chatId);
    await recordPhone(chat, "998901234504", "telegram", "X");
    await db.agentChat.update({ where: { id: chat.id }, data: { messages: [{ role: "user", content: "eski" }], awaitingPhone: true, lastMessageAt: new Date(Date.now() - 8 * 86_400_000) } });
    expect(await activeAgentChat(chatId)).toBeNull(); // free text no longer reaches it, only the center's link
    const reopened = await openAgentChat(centerId, chatId);
    expect(reopened).toMatchObject({ phone: "998901234504", awaitingPhone: false });
    const msgs = reopened.messages as { role: string; content: string }[];
    expect(msgs[0]).toEqual({ role: "user", content: "eski" }); // the transcript is kept for staff
    expect(msgs[1].content).toMatch(/^\[Mijoz 8 kundan keyin qayta yozdi/);
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

describe("lead agent: cards, location and leads without a phone", () => {
  it("show_groups sends code-rendered cards after the agent's text; unknown ids are refused", async () => {
    const chat = await chatFor();
    const m = model(
      msg([text("Mos guruh:"), call("show_groups", { group_ids: [groupId] })], "tool_use"),
      msg([text("Qaysi biri qulay?")], "end_turn"),
      msg([call("show_groups", { group_ids: ["nope"] })], "tool_use"),
      msg([text("ok")], "end_turn"),
    );
    const r = await turn(chat.id, "matematika guruhlari", m.create);
    expect(r.out.map((o) => o.kind)).toEqual(["text", "card", "text"]);
    const card = r.out[1];
    expect(card).toMatchObject({ kind: "card", groupId, button: "✍️ Sinov darsiga yozilish" });
    if (card.kind !== "card") throw new Error("not a card");
    for (const part of ["<b>Abituriyentlar</b>", "Du 15:00-16:30", "650 000 so'm / oy", "Chilonzor, Bunyodkor 1", "dan beri o'qiyapti", "Eng yaqin dars"]) expect(card.html).toContain(part);
    expect(card.html).toMatch(/Bo'sh joy: \d+/); // earlier tests booked into this group
    expect(r.replies).toEqual(["Mos guruh:", "Qaysi biri qulay?"]);
    await turn(chat.id, "yana", m.create);
    expect(lastToolResult(m.seen)).toEqual({ error: true, body: expect.stringContaining("nope") });
  });

  it("send_location sends the branch's map point, and refuses a branch without one", async () => {
    const chat = await chatFor();
    const m = model(msg([call("send_location", { branch_id: branchId })], "tool_use"), msg([text("Manzil: Bunyodkor 1")], "end_turn"));
    await turn(chat.id, "qanday boraman?", m.create);
    expect(lastToolResult(m.seen)).toEqual({ error: true, body: expect.stringContaining("joylashuvi kiritilmagan") });
    await db.branch.update({ where: { id: branchId }, data: { latitude: 41.285, longitude: 69.204 } });
    const m2 = model(msg([call("send_location", { branch_id: branchId })], "tool_use"), msg([text("Xaritani yubordim")], "end_turn"));
    const r = await turn(chat.id, "qayerdasiz?", m2.create);
    expect(r.out[0]).toEqual({ kind: "venue", latitude: 41.285, longitude: 69.204, title: "Chilonzor", address: "Bunyodkor 1" });
    // the system prompt now tells the model which branches have a map point
    expect(centerPrompt(m2.seen[0])).toContain(`branch_id: ${branchId}, xaritada joylashuvi bor`);
  });

  it("a phone that already belongs to an open lead moves the chat there; the phoneless lead is archived with its notes moved", async () => {
    const form = await db.lead.create({ data: { centerId, name: "Formadan", phone: "998901234510", source: "Sayt formasi" } });
    const chat = await chatFor();
    await turn(chat.id, "salom", model(msg([text("Assalomu alaykum")], "end_turn")).create);
    const temp = (await db.agentChat.findUniqueOrThrow({ where: { id: chat.id } })).leadId!;
    await recordPhone(await db.agentChat.findUniqueOrThrow({ where: { id: chat.id } }), "998901234510", "telegram", "Sarvar Aliyev");
    expect((await db.agentChat.findUniqueOrThrow({ where: { id: chat.id } })).leadId).toBe(form.id);
    expect((await db.lead.findUniqueOrThrow({ where: { id: temp } })).archivedAt).not.toBeNull();
    const notes = await db.leadNote.findMany({ where: { leadId: form.id } });
    expect(notes.map((n) => n.text)).toEqual(expect.arrayContaining(["🤖 Telegram'da AI agentga yozdi (raqam hali yo'q)", "🤖 ↻ Telegram'da AI agentga yozdi (raqam: Telegram kontakt)"]));
    expect(await db.leadNote.count({ where: { leadId: temp } })).toBe(0);
  });

  it("a staff message goes out through the bot and the agent continues with it; one sent mid-turn is not lost", async () => {
    const chat = await chatFor();
    await turn(chat.id, "narxi qancha?", model(msg([text("650 000 so'm / oy")], "end_turn")).create);
    const leadId = (await db.agentChat.findUniqueOrThrow({ where: { id: chat.id } })).leadId!;
    await sendStaffMessage({ centerId, chatRowId: chat.id, userId: ownerId, staffName: "Ega", text: "Salom! Ertaga sinov darsiga kelasizmi?" });
    expect(await db.notification.findFirst({ where: { centerId, chatId: chat.chatId, text: "Salom! Ertaga sinov darsiga kelasizmi?" } })).not.toBeNull();
    expect(await db.lead.findUniqueOrThrow({ where: { id: leadId } })).toMatchObject({ stage: "CONTACTED" });
    expect((await db.leadNote.findFirstOrThrow({ where: { leadId, text: { startsWith: "✉️" } } })).createdById).toBe(ownerId);

    // the person answers: the model sees the staff message and the answer as one turn, staff named
    let staffDuringTurn = false;
    const m = model(msg([text("Ajoyib, yozib qo'yaman")], "end_turn"));
    const create: CreateMessage = async (p) => {
      if (!staffDuringTurn) {
        staffDuringTurn = true;
        await sendStaffMessage({ centerId, chatRowId: chat.id, userId: ownerId, staffName: "Ega", text: "Manzil: Bunyodkor 1" });
      }
      return m.create(p);
    };
    await turn(chat.id, "ha, kelaman", create);
    // the person's turn is the last user message; the state block (role:system) follows it
    const lastUser = m.seen[0].messages.filter((x) => x.role === "user").at(-1)!;
    expect(lastUser.role).toBe("user");
    expect(JSON.stringify(lastUser.content)).toContain("Markaz xodimi Ega mijozga Telegram orqali yozdi");
    expect(JSON.stringify(lastUser.content)).toContain("ha, kelaman");
    // written while the turn ran: still in the saved history, after the turn
    const saved = JSON.stringify((await db.agentChat.findUniqueOrThrow({ where: { id: chat.id } })).messages);
    expect(saved.indexOf("Manzil: Bunyodkor 1")).toBeGreaterThan(saved.indexOf("Ajoyib, yozib qo'yaman"));
  });

  it("the owner answers a question by replying to its Telegram notification: it reaches the person like a lead-page message", async () => {
    const chat = await chatFor();
    const m = model(msg([call("ask_teacher", { question: "Shanba kechki guruh ochiladimi?" })], "tool_use"), msg([text("Ustozga yubordim")], "end_turn"));
    await turn(chat.id, "shanba kechqurun guruh bormi", m.create);
    const leadId = (await db.agentChat.findUniqueOrThrow({ where: { id: chat.id } })).leadId!;
    const n = await db.notification.findFirstOrThrow({ where: { centerId, chatId: OWNER_CHAT, text: { contains: "Shanba kechki guruh ochiladimi" } }, orderBy: { createdAt: "desc" } });
    expect(n.text).toContain(`/leads/${leadId}?chat=${chat.id}`);
    expect(n.text).toContain("shu xabarga reply qiling");
    // Telegram hands the bot the replied message as plain text, without the HTML tags
    const repliedText = n.text.replace(/<[^>]+>/g, "");
    const answer = "Yetarli o'quvchi yig'ilsa, shanba kechki guruh ochamiz";
    // a chat not linked to staff of this center may not answer
    expect(await answerFromTelegram({ staffChatId: "939999999", repliedText, text: answer })).toBe("forbidden");
    // the owner's linked chat (its own id: bot-handlers tests use the 92000000x chats on the same database)
    const ownerTg = "939900001";
    await db.telegramLink.create({ data: { chatId: ownerTg, kind: "STAFF", refId: ownerId, phone: "998901230002" } });
    // a reply to any other bot message is not an answer
    expect(await answerFromTelegram({ staffChatId: ownerTg, repliedText: "📊 Hisobot", text: answer })).toBeNull();
    expect(await answerFromTelegram({ staffChatId: ownerTg, repliedText, text: answer })).toBe("sent");
    expect(await db.notification.findFirst({ where: { centerId, chatId: chat.chatId, text: answer } })).not.toBeNull();
    const saved = JSON.stringify((await db.agentChat.findUniqueOrThrow({ where: { id: chat.id } })).messages);
    expect(saved).toContain(`Markaz xodimi Ega mijozga Telegram orqali yozdi: «${answer}»`);
    expect((await db.leadNote.findFirstOrThrow({ where: { leadId, text: { startsWith: "✉️" } } })).createdById).toBe(ownerId);
  });

  it("a message that is only a phone number is caught before the model, valid or not; fixed texts follow a Cyrillic chat", () => {
    expect(looksLikePhone("+99899009090")).toBe(true); // live: a digit short, the model claimed typed numbers are refused
    expect(normalizePhone("+99899009090")).toBeNull(); // so the bot answers it with badPhone
    expect(looksLikePhone("90 123 45 67")).toBe(true);
    expect(looksLikePhone("24.11.2026")).toBe(false);
    expect(looksLikePhone("2 ta farzandim bor")).toBe(false);
    const cyrillicChat = { messages: [{ role: "user", content: "Салом, курслар борми?" }] } as unknown as AgentChat;
    expect(agentNotice(cyrillicChat, "badPhone", "uz")).toMatch(/^Бу рақам/);
    expect(agentNotice({ messages: [] } as unknown as AgentChat, "badPhone", "uz")).toMatch(/^Bu raqam/);
  });

  it("the owner's daily report counts today's Telegram AI leads and those without a number", async () => {
    const text = await ownerReport(ownerId, today);
    expect(text).toMatch(/Telegram AI: bugun \+\d+ mijoz, \d+ tasi raqam qoldirmagan/);
    expect(text).toContain("/leads?nophone=1");
  });
});

describe("lead agent: second live chat fixes", () => {
  async function bookedChat(first: string, lessonDate?: string) {
    const chat = await chatFor();
    await recordPhone(chat, `99890${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`, "telegram", `${first} Test`);
    const m = model(
      msg([call("book_trial", { group_id: groupId, ...(lessonDate ? { lesson_date: lessonDate } : {}), student_first_name: first, student_last_name: "Test", for_self: true, goal: "x", level_summary: "y" })], "tool_use"),
      msg([text("Yozildingiz")], "end_turn"),
    );
    await turn(chat.id, "yozing", m.create);
    return { chat, m };
  }

  it("book_trial takes the date the person agreed to, and refuses a date without a lesson", async () => {
    const { chat, m } = await bookedChat("Sanali", formatDate(addDays(today, 3)));
    expect(JSON.parse(lastToolResult(m.seen).body).trial_lesson).toMatchObject({ days_from_today: 3 });
    const student = (await db.agentChat.findUniqueOrThrow({ where: { id: chat.id } })).studentId!;
    expect(await db.enrollment.findFirstOrThrow({ where: { studentId: student, groupId } })).toMatchObject({ startDate: fromISODate(addDays(today, 3)) });
    const { m: m2 } = await bookedChat("Notogri", formatDate(addDays(today, 2)));
    expect(lastToolResult(m2.seen)).toEqual({ error: true, body: expect.stringContaining("dars yo'q") });
  });

  it("cancel_trial only asks, with two buttons; the person's 'yes' cancels: off the roster, not 'left', lead back to contacted, teacher told", async () => {
    const { chat } = await bookedChat("Bekor");
    const row = await db.agentChat.findUniqueOrThrow({ where: { id: chat.id } });
    const enrollment = await db.enrollment.findFirstOrThrow({ where: { studentId: row.studentId!, groupId } });
    expect(await db.lead.findUniqueOrThrow({ where: { id: row.leadId! } })).toMatchObject({ stage: "TRIAL_BOOKED" });
    const m = model(msg([call("cancel_trial", { group_id: groupId, reason: "boshqa markazga boradi" })], "tool_use"), msg([text("Tasdiqlash uchun pastdagi tugmani bosing")], "end_turn"));
    const r = await turn(chat.id, "bekor qiling", m.create);
    expect(JSON.parse(lastToolResult(m.seen).body)).toMatchObject({ ok: true, confirmation_shown: true });
    // nothing is cancelled by the model's call; the question comes last, under the agent's text
    expect(await db.enrollment.findUnique({ where: { id: enrollment.id } })).not.toBeNull();
    expect(r.out.map((o) => o.kind)).toEqual(["text", "confirm"]);
    expect(r.out[1]).toMatchObject({ kind: "confirm", enrollmentId: enrollment.id, yes: "✅ Ha, bekor qilish", no: "↩️ Yo'q, qolsin" });
    expect(r.out[1].kind === "confirm" && r.out[1].html).toContain("Abituriyentlar");

    // "no" keeps the booking; the agent hears it
    expect(await confirmCancel({ chatRowId: chat.id, enrollmentId: enrollment.id, yes: false, personName: "Bekor Test" })).toContain("bekor qilinmadi, o'z kuchida");
    expect(await db.enrollment.findUnique({ where: { id: enrollment.id } })).not.toBeNull();

    // "yes" cancels, by code
    const done = await confirmCancel({ chatRowId: chat.id, enrollmentId: enrollment.id, yes: true, personName: "Bekor Test" });
    expect(done).toMatch(/^\[Mijoz «Ha, bekor qilish» tugmasini bosdi: «Abituriyentlar» guruhidagi \d{2}\.\d{2}\.\d{4} sinov darsi bekor qilindi\]$/);
    expect(await db.enrollment.findUnique({ where: { id: enrollment.id } })).toBeNull();
    expect(await db.enrollment.count({ where: { status: "LEFT", studentId: row.studentId! } })).toBe(0);
    expect(await db.lead.findUniqueOrThrow({ where: { id: row.leadId! } })).toMatchObject({ stage: "CONTACTED" });
    const log = await db.auditLog.findFirstOrThrow({ where: { entityId: enrollment.id, action: "trial.cancel" } });
    expect(log.actor).toBe("AGENT");
    expect(await db.notification.findFirst({ where: { centerId, chatId: TEACHER_CHAT, text: { contains: "Sinov darsi bekor qilindi" } } })).not.toBeNull();
    const notes = (await db.leadNote.findMany({ where: { leadId: row.leadId! } })).map((x) => x.text).join("\n");
    expect(notes).toContain("Sabab: boshqa markazga boradi");
    expect(notes).toContain("mijoz tugma bilan tasdiqladi");
    // a second press of the old button has nothing to do, and the model cannot offer it again
    expect(await confirmCancel({ chatRowId: chat.id, enrollmentId: enrollment.id, yes: true, personName: "Bekor Test" })).toBeNull();
    const m2 = model(msg([call("cancel_trial", { group_id: groupId, reason: "x" })], "tool_use"), msg([text("ok")], "end_turn"));
    await turn(chat.id, "bekor qiling", m2.create);
    expect(lastToolResult(m2.seen)).toEqual({ error: true, body: expect.stringContaining("ochiq sinov darsi yo'q") });
  });

  it("a trial whose day has passed is never the bot's to cancel (it may have happened), neither offered nor on a press", async () => {
    const { chat } = await bookedChat("Otgan");
    const row = await db.agentChat.findUniqueOrThrow({ where: { id: chat.id } });
    const enrollment = await db.enrollment.findFirstOrThrow({ where: { studentId: row.studentId!, groupId } });
    // the old live case: a booking for yesterday, attendance not marked
    await db.enrollment.update({ where: { id: enrollment.id }, data: { startDate: fromISODate(addDays(today, -1)) } });
    const m = model(msg([call("cancel_trial", { group_id: groupId, reason: "x" })], "tool_use"), msg([text("ok")], "end_turn"));
    const r = await turn(chat.id, "bekor qiling", m.create);
    expect(lastToolResult(m.seen)).toEqual({ error: true, body: expect.stringContaining("bo'lib o'tgan") });
    expect(r.out.some((o) => o.kind === "confirm")).toBe(false);
    expect(await confirmCancel({ chatRowId: chat.id, enrollmentId: enrollment.id, yes: true, personName: "Otgan Test" })).toContain("bekor qilib bo'lmadi");
    expect(await db.enrollment.findUnique({ where: { id: enrollment.id } })).not.toBeNull();
  });

  it("stores the whole conversation for staff while the model sees only the last part", async () => {
    const chat = await chatFor();
    const long = Array.from({ length: 80 }, (_, i) => [
      { role: "user", content: `savol ${i}` },
      { role: "assistant", content: [{ type: "text", text: `javob ${i}` }] },
    ]).flat();
    await db.agentChat.update({ where: { id: chat.id }, data: { messages: long } });
    const m = model(msg([text("yangi javob")], "end_turn"));
    await turn(chat.id, "yangi savol", m.create);
    expect(m.seen[0].messages.length).toBeLessThanOrEqual(60 + 2); // the window, the new message and the state block
    expect(JSON.stringify(m.seen[0].messages)).not.toContain("savol 0\"");
    const saved = (await db.agentChat.findUniqueOrThrow({ where: { id: chat.id } })).messages as unknown[];
    expect(saved).toHaveLength(162);
    expect(JSON.stringify(saved[0])).toContain("savol 0");
  });
});

describe("lead agent: third live chat fixes", () => {
  it("a booking that fell out of the model's window still reaches it through the state block", async () => {
    const chat = await chatFor();
    await recordPhone(chat, "998901234520", "telegram", "Unutilgan");
    await turn(chat.id, "yozing", model(msg([call("book_trial", { group_id: groupId, student_first_name: "Unutilgan", student_last_name: "Bron", for_self: true, goal: "x", level_summary: "y" })], "tool_use"), msg([text("ok")], "end_turn")).create);
    const row = await db.agentChat.findUniqueOrThrow({ where: { id: chat.id } });
    const filler = Array.from({ length: 80 }, (_, i) => [
      { role: "user", content: `gap ${i}` },
      { role: "assistant", content: [{ type: "text", text: `javob ${i}` }] },
    ]).flat();
    await db.agentChat.update({ where: { id: chat.id }, data: { messages: [...(row.messages as object[]), ...filler] } });
    const m = model(msg([text("Sizda bitta sinov darsi bor")], "end_turn"));
    await turn(chat.id, "darslarim qachon?", m.create);
    expect(JSON.stringify(m.seen[0].messages)).not.toContain("book_trial"); // gone from the window…
    expect(statePart(m.seen[0])).toContain(`«Abituriyentlar» (group_id: ${groupId})`); // …but not from the state
    expect(statePart(m.seen[0])).toContain("Telefon raqam: olingan (Telegram kontakt)");
    expect(centerPrompt(m.seen[0])).not.toContain("Telefon raqam: olingan"); // the state is not in the cached prefix
  });

  it("a parent's two children: both trials are in the state and each can be cancelled", async () => {
    const chat = await chatFor();
    await recordPhone(chat, "998901234521", "telegram", "Ota");
    const book = (first: string, gid: string) =>
      model(msg([call("book_trial", { group_id: gid, student_first_name: first, student_last_name: "Aka", for_self: false, parent_name: "Ota", goal: "x", level_summary: "y" })], "tool_use"), msg([text("ok")], "end_turn"));
    const base = await db.group.findUniqueOrThrow({ where: { id: groupId } });
    const extra = await db.group.create({ data: { centerId, branchId, courseId: base.courseId, teacherId: base.teacherId, code: 9, name: "Ikkinchi guruh", capacity: 10, startDate: fromISODate(addDays(today, -5)) } });
    await db.lesson.create({ data: { groupId: extra.id, date: fromISODate(addDays(today, 2)), startTime: "10:00", endTime: "11:30", teacherId: base.teacherId } });
    await turn(chat.id, "birinchisi", book("Birinchi", groupId).create);
    await turn(chat.id, "ikkinchisi", book("Ikkinchi", extra.id).create);
    expect((await db.agentChat.findUniqueOrThrow({ where: { id: chat.id } })).studentIds).toHaveLength(2);
    const m = model(msg([call("cancel_trial", { group_id: groupId, reason: "birinchisi bormaydi" })], "tool_use"), msg([text("ok")], "end_turn"));
    const r = await turn(chat.id, "birinchisini bekor qiling", m.create);
    expect(statePart(m.seen[0])).toContain("Birinchi Aka: «Abituriyentlar»");
    expect(statePart(m.seen[0])).toContain("Ikkinchi Aka: «Ikkinchi guruh»");
    // the earlier child's booking, not chat.studentId's
    const first = await db.enrollment.findFirstOrThrow({ where: { groupId, student: { firstName: "Birinchi", lastName: "Aka" } } });
    expect(r.out.find((o) => o.kind === "confirm")).toMatchObject({ enrollmentId: first.id });
    expect(await confirmCancel({ chatRowId: chat.id, enrollmentId: first.id, yes: true, personName: "Ota" })).toContain("«Abituriyentlar»");
  });
});

describe("lead agent: prompt caching", () => {
  it("meters cached tokens apart, keeps the state out of the saved history, and weighs cache reads at 1/10 against the cap", async () => {
    const chat = await chatFor();
    const cached = { ...msg([text("Salom")], "end_turn"), usage: { input_tokens: 30, output_tokens: 10, cache_read_input_tokens: 5000, cache_creation_input_tokens: 400 } } as unknown as Anthropic.Beta.BetaMessage;
    await turn(chat.id, "salom", model(cached).create);
    const row = await db.agentChat.findUniqueOrThrow({ where: { id: chat.id } });
    expect(row).toMatchObject({ inputTokens: 30, outputTokens: 10, cacheReadTokens: 5000, cacheWriteTokens: 400 });
    expect(JSON.stringify(row.messages)).not.toContain("mijoz_holati");
    expect(capTokens({ inputTokens: 30, outputTokens: 10, cacheReadTokens: 5000, cacheWriteTokens: 400 })).toBe(30 + 10 + 400 + 500);
  });
});


describe("lead agent: Cyrillic by code", () => {
  it("a Cyrillic conversation gets Cyrillic texts, cards and buttons even when the model answers in Latin; the saved history matches", async () => {
    const chat = await chatFor();
    const m = model(
      msg([text("Mana guruh kartasi:"), call("show_groups", { group_ids: [groupId] })], "tool_use"),
      msg([text("Narxi oyiga 650 000 so'm, o'qituvchi Ustoz. Sinov darsi bepul.")], "end_turn"),
    );
    const r = await turn(chat.id, "Ассалому алайкум, нархи қанча?", m.create);
    expect(r.replies).toEqual(["Мана гуруҳ картаси:", "Нархи ойига 650 000 сўм, ўқитувчи Устоз. Синов дарси бепул."]);
    const card = r.out.find((o) => o.kind === "card");
    if (card?.kind !== "card") throw new Error("no card");
    expect(card.html).toContain("<b>Абитуриентлар</b>"); // tags kept, words in Cyrillic
    expect(card.button).toBe("✍️ Синов дарсига ёзилиш");
    const saved = JSON.stringify((await db.agentChat.findUniqueOrThrow({ where: { id: chat.id } })).messages);
    expect(saved).toContain("Нархи ойига 650 000 сўм");
    expect(saved).not.toContain("Narxi oyiga");
    expect(saved).toContain(`"group_ids":["${groupId}"]`); // tool calls untouched
  });

  it("a Latin conversation is left as the model wrote it", async () => {
    const chat = await chatFor();
    const r = await turn(chat.id, "Salom, narxi qancha?", model(msg([text("Narxi oyiga 650 000 so'm.")], "end_turn")).create);
    expect(r.replies).toEqual(["Narxi oyiga 650 000 so'm."]);
  });
});
