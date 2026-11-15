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
import { stripThinking, trimHistory, type AgentMessage } from "./history";
import { runTurn, type CreateMessage } from "./loop";
import { buildSystemPrompt } from "./prompt";
import { AGENT_TOOLS, ensureLead, executeTool, type AgentCtx } from "./tools";

/** A conversation silent this long starts over (the phone, lead and student links are kept). */
export const IDLE_RESET_DAYS = 7;

/** System markers the model sees instead of raw events. The phone number itself never reaches it. */
export const MARK = {
  start: "[Mijoz botni markaz havolasi orqali ochdi]",
  phone: "[telefon raqam olindi]",
};

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

function ctxOf(chat: AgentChat, personName: string, now?: Date): AgentCtx {
  return {
    centerId: chat.centerId,
    personName,
    now,
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
  const say = (k: keyof typeof TEXT): AgentReply => ({ replies: [agentText(k, h.locale)], askPhone: false, booked: false });
  const settings = readSettings(chat.center.settings).agent;
  if ((!h.create && !anthropicApiKey()) || !settings.enabled || chat.center.disabledAt) return say("paused");

  const rateKey = attemptKey.agentChat(chat.chatId);
  const verdict = await checkAttempts(dbAttemptStore, [{ key: rateKey, rule: RULES.agentChat }], now);
  if (!verdict.allowed) return say("tooMany");
  await recordAttempt(dbAttemptStore, [rateKey], false, now);

  const month = monthKey(todayISO(now));
  const used = await db.agentUsage.findUnique({ where: { centerId_month: { centerId: chat.centerId, month } } });
  if (used && used.inputTokens + used.outputTokens >= settings.monthlyTokenCap) return say("paused");

  const ctx = ctxOf(chat, h.personName, now);
  const history = (chat.messages ?? []) as unknown as AgentMessage[];
  const system = buildSystemPrompt({
    name: chat.center.name,
    phone: chat.center.phone,
    branches: chat.center.branches.map((b) => ({ name: b.name, address: b.address })),
    courses: chat.center.courses.map((c) => c.name),
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
    });
    await saveHistory(chat.id, r.history, now);
    const replies = r.stopped === "refusal" ? [agentText("refused", h.locale)] : r.replies.length ? r.replies : [agentText("error", h.locale)];
    return { replies, askPhone: ctx.chat.awaitingPhone && !ctx.chat.phone, booked: !!ctx.chat.trialGroupId && ctx.chat.trialGroupId !== trialBefore };
  } catch (e) {
    console.error("[agent] turn failed", e);
    // keep the person's message so the next turn still knows it
    await saveHistory(chat.id, [...history, { role: "user", content: h.text }], now);
    return say("error");
  }
}

async function saveHistory(id: string, messages: AgentMessage[], now: Date): Promise<void> {
  const kept = trimHistory(stripThinking(messages));
  await db.agentChat.update({ where: { id }, data: { messages: JSON.parse(JSON.stringify(kept)), lastMessageAt: now } });
}
