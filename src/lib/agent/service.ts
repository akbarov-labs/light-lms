// The lead agent as a service: everything between "a message arrived" and "these are the replies".
// No Telegram here (src/worker/bot/agent.ts does that), so tests run it with a scripted model.
//
// Order of checks on every message: agent switched on (key + center setting) → per-chat rate limit →
// the center's monthly token cap → the turn → metering → saving the trimmed history.
import Anthropic from "@anthropic-ai/sdk";
import type { AgentChat } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { agentModel, anthropicApiKey } from "@/lib/env";
import { readSettings } from "@/lib/settings";
import { monthKey, todayISO } from "@/lib/dates";
import type { Locale } from "@/lib/i18n";
import { dbAttemptStore } from "@/lib/auth/attempts-db";
import { attemptKey, checkAttempts, recordAttempt, RULES } from "@/lib/auth/ratelimit";
import { esc } from "@/lib/messages";
import { enqueue } from "@/lib/notify";
import { audit } from "@/lib/audit";
import { latinToCyrillic } from "@/lib/translit";
import { validLinks } from "@/lib/telegram-links";
import { scopedCenterId } from "@/lib/managed-bots/scope";
import { allowedBranches, effectivePerms, type RoleName } from "@/lib/perms";
import { HISTORY_LIMITS, personTexts, stripThinking, trimHistory, type AgentMessage } from "./history";
import { AgentToolError, runTurn, type CreateMessage, type TurnUsage } from "./loop";
import { buildStateBlock, buildSystemPrompt, conversationScript } from "./prompt";
import { cancelDoneMarker, cancelFailedMarker, cancelKeptMarker, staffMarker } from "./markers";
import { AGENT_TOOLS, cancelConfirmedTrial, chatState, ensureLead, executeTool, trialOfButton, type AgentCtx, type Outbound } from "./tools";
import { logBotMessages, plainText, type BotLogEntry } from "@/lib/services/bot-log";

export { MARK } from "./markers";

/**
 * A conversation silent this long is no longer picked up by free text (only by the center's link again),
 * and on reopening the model is told how long it was away, so old prices, dates and seats are re-checked.
 * Nothing is deleted: staff keep the whole transcript.
 */
export const IDLE_RESET_DAYS = 7;

/** What is kept in the database (the staff transcript); the model gets only the last HISTORY_LIMITS of it. */
export const STORED_LIMITS = { maxMessages: 400, maxChars: 400_000 };

const awayMarker = (days: number) =>
  `[Mijoz ${days} kundan keyin qayta yozdi. Oldingi narx, sana va bo'sh joy ma'lumotlari eskirgan bo'lishi mumkin: kerak bo'lsa vositalar bilan qayta tekshir.]`;

const TEXT: Record<"busy" | "tooMany" | "paused" | "error" | "refused" | "badPhone" | "staleCancel", Record<Locale, string>> = {
  busy: { uz: "Bir daqiqa, oldingi xabaringizga javob yozyapman…", ru: "Минуту, отвечаю на предыдущее сообщение…" },
  tooMany: { uz: "Juda ko'p xabar keldi. Iltimos, bir necha daqiqadan keyin yozing.", ru: "Слишком много сообщений. Пожалуйста, напишите через несколько минут." },
  paused: { uz: "Hozir avtomatik javob bera olmayman. Markaz administratori siz bilan bog'lanadi.", ru: "Сейчас не могу ответить автоматически. Администратор центра свяжется с вами." },
  error: { uz: "Kechirasiz, texnik nosozlik bo'ldi. Bir ozdan keyin qayta yozing.", ru: "Извините, произошла техническая ошибка. Напишите чуть позже." },
  refused: { uz: "Kechirasiz, bu savolga javob bera olmayman. Markaz administratori siz bilan bog'lanadi.", ru: "Извините, на этот вопрос я ответить не могу. Администратор центра свяжется с вами." },
  // live: "+99899009090" (a digit short) reached the model, which claimed typed numbers are not accepted
  badPhone: {
    uz: "Bu raqam to'liq emas yoki noto'g'ri. Uni +998 90 123 45 67 ko'rinishida yozing yoki pastdagi tugmani bosing.",
    ru: "Номер неполный или неверный. Напишите его в виде +998 90 123 45 67 или нажмите кнопку ниже.",
  },
  staleCancel: { uz: "Bu sinov darsi allaqachon bekor qilingan.", ru: "Этот пробный урок уже отменён." },
};
export const agentText = (k: keyof typeof TEXT, l: Locale) => TEXT[k][l];

/** A fixed text sent by code outside a turn, in the conversation's script (Cyrillic chats get Cyrillic). */
export function agentNotice(chat: AgentChat, k: keyof typeof TEXT, l: Locale): string {
  const script = conversationScript(personTexts((chat.messages ?? []) as unknown as AgentMessage[]));
  return script === "cyrillic" ? latinToCyrillic(TEXT[k][l]) : TEXT[k][l];
}

let client: Anthropic | null = null;
function defaultCreate(): CreateMessage {
  client ??= new Anthropic({ apiKey: anthropicApiKey() });
  const c = client;
  return (p) => c.beta.messages.create(p);
}

/** The center a deep link (?start=<slug>) points at, when its agent may answer. */
export async function agentCenterBySlug(slug: string): Promise<{ id: string; name: string } | null> {
  if (!anthropicApiKey() || !/^[a-z0-9-]{1,60}$/.test(slug)) return null;
  return agentCenter(await db.center.findUnique({ where: { slug }, select: { id: true, name: true, settings: true, disabledAt: true } }));
}

/** A center's own bot (managed bots): the center is the bot's, no link needed. */
export async function agentCenterById(id: string): Promise<{ id: string; name: string } | null> {
  if (!anthropicApiKey()) return null;
  return agentCenter(await db.center.findUnique({ where: { id }, select: { id: true, name: true, settings: true, disabledAt: true } }));
}

function agentCenter(c: { id: string; name: string; settings: unknown; disabledAt: Date | null } | null): { id: string; name: string } | null {
  if (!c || c.disabledAt || !readSettings(c.settings).agent.enabled) return null;
  return { id: c.id, name: c.name };
}

/** Open (or reopen) the conversation of this chat with this center. */
export async function openAgentChat(centerId: string, chatId: string, now = new Date()): Promise<AgentChat> {
  const stale = new Date(now.getTime() - IDLE_RESET_DAYS * 86_400_000);
  const existing = await db.agentChat.findUnique({ where: { centerId_chatId: { centerId, chatId } } });
  if (!existing) return db.agentChat.create({ data: { centerId, chatId, lastMessageAt: now } });
  if (existing.lastMessageAt >= stale) return db.agentChat.update({ where: { id: existing.id }, data: { lastMessageAt: now } });
  const days = Math.floor((now.getTime() - existing.lastMessageAt.getTime()) / 86_400_000);
  const messages = [...((existing.messages ?? []) as unknown as AgentMessage[]), { role: "user", content: awayMarker(days) } as AgentMessage];
  return db.agentChat.update({
    where: { id: existing.id },
    data: { lastMessageAt: now, messages: JSON.parse(JSON.stringify(messages)), awaitingPhone: false, trialGroupId: null },
  });
}

/** The conversation a free-text message from this chat belongs to: its most recent one, if not idle. */
export async function activeAgentChat(chatId: string, now = new Date()): Promise<AgentChat | null> {
  const stale = new Date(now.getTime() - IDLE_RESET_DAYS * 86_400_000);
  // in a center's own bot only that center's conversation counts (managed bots)
  const centerId = scopedCenterId();
  return db.agentChat.findFirst({ where: { chatId, lastMessageAt: { gte: stale }, ...(centerId ? { centerId } : {}) }, orderBy: { lastMessageAt: "desc" } });
}

/**
 * Tokens counted against the monthly cap, weighted by what they cost: a cache read costs ~0.1x an input
 * token, so ten count as one; a cache write costs more than input and counts in full (conservative).
 */
export function capTokens(u: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number }): number {
  return u.inputTokens + u.outputTokens + u.cacheWriteTokens + Math.ceil(u.cacheReadTokens / 10);
}

/** Keep the person's Telegram @username current (staff can then write to them directly). */
export async function setAgentUsername(chatRowId: string, username: string | null): Promise<void> {
  await db.agentChat.update({ where: { id: chatRowId }, data: { username: username?.slice(0, 64) ?? null } });
}

function ctxOf(chat: AgentChat, personName: string, now?: Date, locale?: Locale, out?: Outbound[]): AgentCtx {
  return {
    centerId: chat.centerId,
    personName,
    now,
    locale,
    out,
    chat: {
      id: chat.id,
      chatId: chat.chatId,
      leadId: chat.leadId,
      studentId: chat.studentId,
      studentIds: chat.studentIds,
      trialGroupId: chat.trialGroupId,
      phone: chat.phone,
      phoneSource: chat.phoneSource,
      awaitingPhone: chat.awaitingPhone,
    },
  };
}

/** Store the contact phone (from the Telegram contact button, or typed) and make sure a lead exists. */
export async function recordPhone(chat: AgentChat, phone: string, source: "telegram" | "typed", personName: string): Promise<void> {
  // a verified number replaces a typed one; a typed one never replaces a verified one
  if (chat.phone && chat.phoneSource === "telegram" && source === "typed") return;
  const updated = await db.agentChat.update({ where: { id: chat.id }, data: { phone, phoneSource: source, awaitingPhone: false } });
  await ensureLead(ctxOf(updated, personName));
}

export interface AgentReply {
  /** everything to send, in order: the agent's texts, group cards, map pins */
  out: Outbound[];
  /** the agent's texts only (out filtered) */
  replies: string[];
  /** show the "share my phone" button with the last reply */
  askPhone: boolean;
  /** a trial lesson was booked in this turn */
  booked: boolean;
}

export interface HandleInput {
  chatRowId: string;
  text: string;
  personName: string;
  locale: Locale;
  /** the person wrote or pressed something (not a system event such as /start): the lead must exist */
  fromPerson?: boolean;
  /** injected model call (tests); default: the Anthropic API */
  create?: CreateMessage;
  now?: Date;
}

/** What the person saw of one outbound item, as plain text for the conversation log. */
function seenText(o: Outbound): string {
  if (o.kind === "text") return o.text;
  if (o.kind === "card") return `${plainText(o.html)}\n[${o.button}]`;
  if (o.kind === "confirm") return `${plainText(o.html)}\n[${o.yes}] [${o.no}]`;
  return `📍 ${o.title}${o.address ? `, ${o.address}` : ""}`;
}

export async function handleAgentMessage(h: HandleInput): Promise<AgentReply> {
  const r = await agentTurn(h);
  // the conversation log for /conversations: what the person wrote (not system events) and what they saw
  const chat = await db.agentChat.findUnique({ where: { id: h.chatRowId }, select: { centerId: true, chatId: true } });
  if (chat) {
    const entries: BotLogEntry[] = [
      ...(h.fromPerson ? [{ from: "PERSON" as const, text: h.text, name: h.personName }] : []),
      ...r.out.map((o) => ({ from: "BOT" as const, text: seenText(o) })),
    ];
    await logBotMessages(chat.centerId, chat.chatId, "AGENT", entries, h.now);
  }
  return r;
}

async function agentTurn(h: HandleInput): Promise<AgentReply> {
  const now = h.now ?? new Date();
  const chat = await db.agentChat.findUniqueOrThrow({
    where: { id: h.chatRowId },
    include: { center: { include: { branches: { where: { archivedAt: null } }, courses: { where: { archivedAt: null }, select: { name: true } } } } },
  });
  // everyone who wrote is a lead, even when the agent is paused or over its limits
  if (h.fromPerson) await ensureLead(ctxOf(chat, h.personName, now)).then((id) => (chat.leadId = id));
  // the whole conversation is stored for staff; the model sees only its last part (below)
  const stored = (chat.messages ?? []) as unknown as AgentMessage[];
  // the conversation's script, over all the person wrote: stable within a chat, so the cached prefix is too
  const script = conversationScript([...personTexts(stored), h.text]);
  // a Cyrillic conversation gets Cyrillic by code too: the model alone drifted to Latin after tool results
  const cyr = (s: string) => (script === "cyrillic" ? latinToCyrillic(s) : s);
  const say = (k: keyof typeof TEXT): AgentReply => {
    const text = cyr(agentText(k, h.locale));
    return { out: [{ kind: "text", text }], replies: [text], askPhone: false, booked: false };
  };
  const settings = readSettings(chat.center.settings).agent;
  if ((!h.create && !anthropicApiKey()) || !settings.enabled || chat.center.disabledAt) return say("paused");

  const rateKey = attemptKey.agentChat(chat.chatId);
  const verdict = await checkAttempts(dbAttemptStore, [{ key: rateKey, rule: RULES.agentChat }], now);
  if (!verdict.allowed) return say("tooMany");
  await recordAttempt(dbAttemptStore, [rateKey], false, now);

  const month = monthKey(todayISO(now));
  const used = await db.agentUsage.findUnique({ where: { centerId_month: { centerId: chat.centerId, month } } });
  if (used && capTokens(used) >= settings.monthlyTokenCap) return say("paused");

  const out: Outbound[] = [];
  const ctx = ctxOf(chat, h.personName, now, h.locale, out);
  const history = trimHistory(stored, HISTORY_LIMITS);
  const before = stored.slice(0, stored.length - history.length);
  // teachers of open groups, by name and public bio only: phone, salary and login never leave the database
  const teachers = await db.user.findMany({
    where: { centerId: chat.centerId, archivedAt: null, groups: { some: { status: { in: ["ACTIVE", "PLANNED"] } } } },
    select: { name: true, bio: true },
    orderBy: { name: "asc" },
  });
  const system = buildSystemPrompt({
    name: chat.center.name,
    phone: chat.center.phone,
    branches: chat.center.branches.map((b) => ({ id: b.id, name: b.name, address: b.address, hasLocation: b.latitude !== null && b.longitude !== null })),
    courses: chat.center.courses.map((c) => c.name),
    teachers,
    rules: settings.rules,
    script,
  });
  // per turn, after the cached prefix (loop.ts): the chat's bookings, phone status and the script it writes in
  const turnSystem = async () => buildStateBlock({ ...(await chatState(ctx)), script });
  const meter = async (u: TurnUsage) => {
    const tokens = { inputTokens: u.input, outputTokens: u.output, cacheReadTokens: u.cacheRead, cacheWriteTokens: u.cacheWrite };
    const add = Object.fromEntries(Object.entries(tokens).map(([k, v]) => [k, { increment: v }]));
    await db.$transaction([
      db.agentUsage.upsert({
        where: { centerId_month: { centerId: chat.centerId, month } },
        create: { centerId: chat.centerId, month, ...tokens, calls: 1 },
        update: { ...add, calls: { increment: 1 } },
      }),
      db.agentChat.update({ where: { id: chat.id }, data: add }),
    ]);
  };

  const trialBefore = ctx.chat.trialGroupId;
  try {
    const r = await runTurn({
      create: h.create ?? defaultCreate(),
      model: agentModel(),
      system,
      tools: AGENT_TOOLS,
      history,
      userText: h.text,
      turnSystem,
      execute: (name, input) => executeTool(ctx, name, input),
      onUsage: meter,
      onReply: (text) => out.push({ kind: "text", text }),
    });
    // the history keeps what the person saw: Latin replies left in it would pull the next turn back to Latin
    await saveHistory(chat.id, [...before, ...(script === "cyrillic" ? cyrillicReplies(r.history) : r.history)], stored.length, now);
    if (r.stopped === "refusal") out.push({ kind: "text", text: agentText("refused", h.locale) });
    else if (!out.length) out.push({ kind: "text", text: agentText("error", h.locale) });
    if (script === "cyrillic") for (const o of out) toCyrillic(o);
    // a yes/no question goes last, under the agent's "press the button below" (sort is stable)
    out.sort((a, b) => Number(a.kind === "confirm") - Number(b.kind === "confirm"));
    const replies = out.flatMap((o) => (o.kind === "text" ? [o.text] : []));
    return { out, replies, askPhone: ctx.chat.awaitingPhone && !ctx.chat.phone, booked: !!ctx.chat.trialGroupId && ctx.chat.trialGroupId !== trialBefore };
  } catch (e) {
    console.error("[agent] turn failed", e);
    // keep the person's message so the next turn still knows it
    await saveHistory(chat.id, [...stored, { role: "user", content: h.text }], stored.length, now);
    return say("error");
  }
}

/** Everything sent to the person, in Cyrillic: texts, cards (tags and entities kept), buttons, map pins. */
function toCyrillic(o: Outbound): void {
  if (o.kind === "text") o.text = latinToCyrillic(o.text);
  else if (o.kind === "card") Object.assign(o, { html: latinToCyrillic(o.html), button: latinToCyrillic(o.button) });
  else if (o.kind === "confirm") Object.assign(o, { html: latinToCyrillic(o.html), yes: latinToCyrillic(o.yes), no: latinToCyrillic(o.no) });
  else Object.assign(o, { title: latinToCyrillic(o.title), address: latinToCyrillic(o.address) });
}

/** The agent's own text in Cyrillic; tool calls, tool results and the person's words are left alone. */
function cyrillicReplies(messages: AgentMessage[]): AgentMessage[] {
  return messages.map((m) =>
    m.role !== "assistant" || typeof m.content === "string"
      ? m
      : { ...m, content: m.content.map((b) => (b.type === "text" ? { ...b, text: latinToCyrillic(b.text) } : b)) },
  );
}

/**
 * Save a turn's history. A staff message may have been appended while the turn ran (the lead page writes
 * to the same row): whatever was added after the `loaded` messages this turn started from is kept, after it.
 */
async function saveHistory(id: string, messages: AgentMessage[], loaded: number, now: Date): Promise<void> {
  const current = await db.agentChat.findUnique({ where: { id }, select: { messages: true } });
  const added = Array.isArray(current?.messages) ? (current.messages as unknown as AgentMessage[]).slice(loaded) : [];
  const kept = trimHistory(stripThinking([...messages, ...added]), STORED_LIMITS);
  await db.agentChat.update({ where: { id }, data: { messages: JSON.parse(JSON.stringify(kept)), lastMessageAt: now } });
}

/**
 * The person pressed a "cancel this trial?" button. "Yes" cancels here, by code; either way the agent then
 * hears what happened as a marker (the caller runs the turn), so a reschedule goes on to the new booking.
 * Returns null for a stale button (the trial is already gone): nothing to tell the agent.
 */
export async function confirmCancel(a: { chatRowId: string; enrollmentId: string; yes: boolean; personName: string; now?: Date }): Promise<string | null> {
  const chat = await db.agentChat.findUniqueOrThrow({ where: { id: a.chatRowId } });
  const ctx = ctxOf(chat, a.personName, a.now);
  if (!a.yes) {
    const t = await trialOfButton(ctx, a.enrollmentId);
    return t ? cancelKeptMarker(t.group, t.date) : null;
  }
  try {
    const done = await cancelConfirmedTrial(ctx, a.enrollmentId);
    return done ? cancelDoneMarker(done.group, done.date) : null;
  } catch (e) {
    if (e instanceof AgentToolError) return cancelFailedMarker(e.message);
    throw e;
  }
}

export const STAFF_MESSAGE_MAX = 2000;

/**
 * A staff member writes to the person through the bot (from the lead page): the message is queued for
 * Telegram and added to the agent's history as a marker, so when the person answers, the agent knows
 * what was said and by whom. A new lead moves to "contacted", like a note does.
 */
export async function sendStaffMessage(a: { centerId: string; chatRowId: string; userId: string; staffName: string; text: string; now?: Date }): Promise<void> {
  const text = a.text.trim().slice(0, STAFF_MESSAGE_MAX);
  if (!text) return;
  const now = a.now ?? new Date();
  await db.$transaction(async (tx) => {
    const chat = await tx.agentChat.findFirst({ where: { id: a.chatRowId, centerId: a.centerId }, select: { id: true, chatId: true, leadId: true } });
    if (!chat) throw new Error("agent chat not found");
    await enqueue(tx, a.centerId, [{ chatId: chat.chatId, locale: "uz" }], () => esc(text));
    // atomic append: a turn running right now keeps it too (saveHistory re-reads what was added)
    const marker: AgentMessage = { role: "user", content: staffMarker(a.staffName, text) };
    await tx.$executeRaw`UPDATE "AgentChat" SET messages = messages || ${JSON.stringify([marker])}::jsonb WHERE id = ${chat.id}`;
    // the conversation is live again: the person's answer goes to the agent, not to the idle reset
    await tx.agentChat.update({ where: { id: chat.id }, data: { lastMessageAt: now } });
    if (chat.leadId) {
      await tx.leadNote.create({ data: { leadId: chat.leadId, text: `✉️ Telegram (bot orqali): ${text}`, createdById: a.userId, actor: "USER" } });
      await tx.lead.updateMany({ where: { id: chat.leadId, stage: "NEW" }, data: { stage: "CONTACTED" } });
      await audit(tx, { centerId: a.centerId, userId: a.userId, entity: "Lead", entityId: chat.leadId, action: "agent.staffMessage", after: { chat: chat.id, length: text.length } });
    }
    return chat.chatId;
  }).then((chatId) => logBotMessages(a.centerId, chatId, "AGENT", [{ from: "STAFF", text, name: a.staffName }], now));
}

/** First line of an ask_teacher notification, and the link in it (written by tools.ts askTeacher). */
export const QUESTION_HEAD = "🤖❓";
const LEAD_LINK = /\/leads\/([a-z0-9]{1,40})(?:\?chat=([a-z0-9]{1,40}))?/;

/**
 * A staff member answered a customer's question by replying to the bot's "🤖❓" notification in Telegram:
 * the answer reaches the customer exactly like one written on the lead page (sendStaffMessage: queued for
 * Telegram, a marker in the agent's history, a lead note, audit). The first live test: the owner replied
 * in Telegram, as anyone would, and the answer went nowhere.
 * Returns null when the replied message is not such a notification. The caller checks that the replied
 * message is the bot's own, so the text and the link in it were written by us, not the sender.
 * Who may answer: a staff member of the lead's center, linked to this chat, with the "leads" permission
 * and access to the lead's branch — the same rule as the lead page.
 */
export async function answerFromTelegram(a: { staffChatId: string; repliedText: string; text: string; now?: Date }): Promise<"sent" | "forbidden" | "notFound" | null> {
  if (!a.repliedText.startsWith(QUESTION_HEAD)) return null;
  const m = a.repliedText.match(LEAD_LINK);
  if (!m) return null;
  const lead = await db.lead.findUnique({ where: { id: m[1] }, select: { id: true, centerId: true, branchId: true } });
  if (!lead) return "notFound";
  const links = await validLinks(a.staffChatId);
  const staff = await db.user.findMany({
    where: { id: { in: links.staffIds }, centerId: lead.centerId, archivedAt: null, center: { disabledAt: null } },
    select: { id: true, name: true, role: true, perms: true, branches: { select: { branchId: true } } },
  });
  const me = staff.find((u) => {
    const role = u.role as RoleName;
    const branches = allowedBranches(role, u.branches.map((b) => b.branchId));
    return effectivePerms(role, u.perms).has("leads") && (!lead.branchId || !branches || branches.includes(lead.branchId));
  });
  if (!me) return "forbidden";
  const chat = await db.agentChat.findFirst({
    where: { leadId: lead.id, centerId: lead.centerId, ...(m[2] ? { id: m[2] } : {}) },
    orderBy: { lastMessageAt: "desc" },
    select: { id: true },
  });
  if (!chat) return "notFound";
  await sendStaffMessage({ centerId: lead.centerId, chatRowId: chat.id, userId: me.id, staffName: me.name, text: a.text, now: a.now });
  return "sent";
}
