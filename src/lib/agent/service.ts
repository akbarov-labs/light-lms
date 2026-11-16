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
import { stripThinking, trimHistory, type AgentMessage } from "./history";
import { runTurn, type CreateMessage } from "./loop";
import { buildSystemPrompt } from "./prompt";
import { staffMarker } from "./markers";
import { AGENT_TOOLS, ensureLead, executeTool, type AgentCtx, type Outbound } from "./tools";

export { MARK } from "./markers";

/** A conversation silent this long starts over (the phone, lead and student links are kept). */
export const IDLE_RESET_DAYS = 7;

const TEXT: Record<"busy" | "tooMany" | "paused" | "error" | "refused", Record<Locale, string>> = {
  busy: { uz: "Bir daqiqa, oldingi xabaringizga javob yozyapman…", ru: "Минуту, отвечаю на предыдущее сообщение…" },
  tooMany: { uz: "Juda ko'p xabar keldi. Iltimos, bir necha daqiqadan keyin yozing.", ru: "Слишком много сообщений. Пожалуйста, напишите через несколько минут." },
  paused: { uz: "Hozir avtomatik javob bera olmayman. Markaz administratori siz bilan bog'lanadi.", ru: "Сейчас не могу ответить автоматически. Администратор центра свяжется с вами." },
  error: { uz: "Kechirasiz, texnik nosozlik bo'ldi. Bir ozdan keyin qayta yozing.", ru: "Извините, произошла техническая ошибка. Напишите чуть позже." },
  refused: { uz: "Kechirasiz, bu savolga javob bera olmayman. Markaz administratori siz bilan bog'lanadi.", ru: "Извините, на этот вопрос я ответить не могу. Администратор центра свяжется с вами." },
};
export const agentText = (k: keyof typeof TEXT, l: Locale) => TEXT[k][l];

let client: Anthropic | null = null;
function defaultCreate(): CreateMessage {
  client ??= new Anthropic({ apiKey: anthropicApiKey() });
  const c = client;
  return (p) => c.beta.messages.create(p);
}

/** The center a deep link (?start=<slug>) points at, when its agent may answer. */
export async function agentCenterBySlug(slug: string): Promise<{ id: string; name: string } | null> {
  if (!anthropicApiKey() || !/^[a-z0-9-]{1,60}$/.test(slug)) return null;
  const c = await db.center.findUnique({ where: { slug }, select: { id: true, name: true, settings: true, disabledAt: true } });
  if (!c || c.disabledAt || !readSettings(c.settings).agent.enabled) return null;
  return { id: c.id, name: c.name };
}

/** Open (or reopen) the conversation of this chat with this center. */
export async function openAgentChat(centerId: string, chatId: string, now = new Date()): Promise<AgentChat> {
  const stale = new Date(now.getTime() - IDLE_RESET_DAYS * 86_400_000);
  const existing = await db.agentChat.findUnique({ where: { centerId_chatId: { centerId, chatId } } });
  if (!existing) return db.agentChat.create({ data: { centerId, chatId, lastMessageAt: now } });
  return db.agentChat.update({
    where: { id: existing.id },
    data: { lastMessageAt: now, ...(existing.lastMessageAt < stale ? { messages: [], awaitingPhone: false, trialGroupId: null } : {}) },
  });
}

/** The conversation a free-text message from this chat belongs to: its most recent one, if not idle. */
export async function activeAgentChat(chatId: string, now = new Date()): Promise<AgentChat | null> {
  const stale = new Date(now.getTime() - IDLE_RESET_DAYS * 86_400_000);
  return db.agentChat.findFirst({ where: { chatId, lastMessageAt: { gte: stale } }, orderBy: { lastMessageAt: "desc" } });
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

export async function handleAgentMessage(h: HandleInput): Promise<AgentReply> {
  const now = h.now ?? new Date();
  const chat = await db.agentChat.findUniqueOrThrow({
    where: { id: h.chatRowId },
    include: { center: { include: { branches: { where: { archivedAt: null } }, courses: { where: { archivedAt: null }, select: { name: true } } } } },
  });
  // everyone who wrote is a lead, even when the agent is paused or over its limits
  if (h.fromPerson) await ensureLead(ctxOf(chat, h.personName, now)).then((id) => (chat.leadId = id));
  const say = (k: keyof typeof TEXT): AgentReply => {
    const text = agentText(k, h.locale);
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
  if (used && used.inputTokens + used.outputTokens >= settings.monthlyTokenCap) return say("paused");

  const out: Outbound[] = [];
  const ctx = ctxOf(chat, h.personName, now, h.locale, out);
  const history = (chat.messages ?? []) as unknown as AgentMessage[];
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
  });
  const meter = async (u: { input: number; output: number }) => {
    await db.$transaction([
      db.agentUsage.upsert({
        where: { centerId_month: { centerId: chat.centerId, month } },
        create: { centerId: chat.centerId, month, inputTokens: u.input, outputTokens: u.output, calls: 1 },
        update: { inputTokens: { increment: u.input }, outputTokens: { increment: u.output }, calls: { increment: 1 } },
      }),
      db.agentChat.update({ where: { id: chat.id }, data: { inputTokens: { increment: u.input }, outputTokens: { increment: u.output } } }),
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
      execute: (name, input) => executeTool(ctx, name, input),
      onUsage: meter,
      onReply: (text) => out.push({ kind: "text", text }),
    });
    await saveHistory(chat.id, r.history, history.length, now);
    if (r.stopped === "refusal") out.push({ kind: "text", text: agentText("refused", h.locale) });
    else if (!out.length) out.push({ kind: "text", text: agentText("error", h.locale) });
    const replies = out.flatMap((o) => (o.kind === "text" ? [o.text] : []));
    return { out, replies, askPhone: ctx.chat.awaitingPhone && !ctx.chat.phone, booked: !!ctx.chat.trialGroupId && ctx.chat.trialGroupId !== trialBefore };
  } catch (e) {
    console.error("[agent] turn failed", e);
    // keep the person's message so the next turn still knows it
    await saveHistory(chat.id, [...history, { role: "user", content: h.text }], history.length, now);
    return say("error");
  }
}

/**
 * Save a turn's history. A staff message may have been appended while the turn ran (the lead page writes
 * to the same row): whatever was added after the `loaded` messages this turn started from is kept, after it.
 */
async function saveHistory(id: string, messages: AgentMessage[], loaded: number, now: Date): Promise<void> {
  const current = await db.agentChat.findUnique({ where: { id }, select: { messages: true } });
  const added = Array.isArray(current?.messages) ? (current.messages as unknown as AgentMessage[]).slice(loaded) : [];
  const kept = trimHistory(stripThinking([...messages, ...added]));
  await db.agentChat.update({ where: { id }, data: { messages: JSON.parse(JSON.stringify(kept)), lastMessageAt: now } });
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
  });
}
