// Sabaq's own sales agent as a service: "a stranger wrote to the bot" → the replies. No Telegram here
// (src/worker/bot/sales.ts does that): the worker passes `notifyTeam`, which sends a message to the team
// chat and returns its message id. A team member's reply to that message goes back to the person.
//
// Checks on every message: switched on (SALES_AGENT + key) → per-chat rate limit → monthly token cap →
// the turn → metering → saving the trimmed history. The same model, loop and history rules as a center's
// lead agent (src/lib/agent), with its own prompt and two tools.
import Anthropic from "@anthropic-ai/sdk";
import type { SalesChat } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { agentModel, anthropicApiKey, mainSiteUrl, rawAppUrl, salesMonthlyTokenCap } from "@/lib/env";
import { BRAND, demoHref, signupClosed } from "@/config/brand";
import { monthKey, todayISO } from "@/lib/dates";
import type { Locale } from "@/lib/i18n";
import { esc } from "@/lib/messages";
import { dbAttemptStore } from "@/lib/auth/attempts-db";
import { attemptKey, checkAttempts, recordAttempt, RULES } from "@/lib/auth/ratelimit";
import { HISTORY_LIMITS, stripThinking, trimHistory, type AgentMessage } from "@/lib/agent/history";
import { AgentToolError, runTurn, type AgentTool, type CreateMessage, type TurnUsage } from "@/lib/agent/loop";
import { capTokens } from "@/lib/agent/service";
import { buildSalesPrompt } from "./prompt";

/** A conversation silent this long starts over (the old history stays for the model as context). */
export const SALES_IDLE_DAYS = 14;
const STORED_LIMITS = { maxMessages: 400, maxChars: 400_000 };

export const SALES_MARK = {
  start: "[Odam botni ochdi (/start)]",
  phone: "[telefon raqam olindi]",
} as const;
export const teamReplyMarker = (text: string) => `[Sabaq jamoasi yozdi: «${text.replace(/»/g, '"')}»]`;

const TEXT: Record<"tooMany" | "paused" | "error", Record<Locale, string>> = {
  tooMany: { uz: "Juda ko'p xabar keldi. Iltimos, bir necha daqiqadan keyin yozing.", ru: "Слишком много сообщений. Пожалуйста, напишите через несколько минут." },
  paused: { uz: "Hozir avtomatik javob bera olmayman. Jamoamiz siz bilan bog'lanadi.", ru: "Сейчас не могу ответить автоматически. Наша команда свяжется с вами." },
  error: { uz: "Kechirasiz, texnik nosozlik bo'ldi. Bir ozdan keyin qayta yozing.", ru: "Извините, произошла техническая ошибка. Напишите чуть позже." },
};
export const salesText = (k: keyof typeof TEXT, l: Locale) => TEXT[k][l];

export const SALES_TOOLS: AgentTool[] = [
  {
    name: "request_phone",
    description: "Odamga Telegram'da «Raqamni yuborish» tugmasini ko'rsatadi. Faqat jamoa bog'lanishi kerak bo'lganda (boshlash, demo, qo'ng'iroq) yoki markazga ulanish uchun.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "notify_team",
    description:
      "Sabaq jamoasiga Telegram'da xabar yuboradi. kind=lead: odam boshlamoqchi yoki bog'lanishni so'radi. kind=question: javobi ma'lumotlarda yo'q savol. Jamoa javobi keyin «[Sabaq jamoasi yozdi: ...]» bo'lib keladi.",
    input_schema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: ["lead", "question"] },
        summary: { type: "string", description: "Jamoa uchun qisqa: kim (ism, roli), markaz nomi, o'quvchilar soni, nima xohlaydi yoki savoli aynan." },
      },
      required: ["kind", "summary"],
      additionalProperties: false,
    },
  },
];

let client: Anthropic | null = null;
function defaultCreate(): CreateMessage {
  client ??= new Anthropic({ apiKey: anthropicApiKey() });
  const c = client;
  return (p) => c.beta.messages.create(p);
}

/** Open (or touch) the conversation of this chat. */
export async function openSalesChat(chatId: string, who: { name?: string | null; username?: string | null } = {}, now = new Date()): Promise<SalesChat> {
  const data = { lastMessageAt: now, ...(who.name ? { name: who.name.slice(0, 120) } : {}), ...(who.username !== undefined ? { username: who.username } : {}) };
  return db.salesChat.upsert({ where: { chatId }, create: { chatId, ...data }, update: data });
}

/** This chat's conversation, if it has one that is not idle. */
export async function activeSalesChat(chatId: string, now = new Date()): Promise<SalesChat | null> {
  const stale = new Date(now.getTime() - SALES_IDLE_DAYS * 86_400_000);
  return db.salesChat.findFirst({ where: { chatId, lastMessageAt: { gte: stale } } });
}

/** A phone shared with the button or typed; the model only hears that one arrived. */
export async function recordSalesPhone(chatRowId: string, phone: string): Promise<void> {
  await db.salesChat.update({ where: { id: chatRowId }, data: { phone, awaitingPhone: false } });
}

export interface SalesInput {
  chatRowId: string;
  text: string;
  locale: Locale;
  /** sends HTML to the team chat; returns the sent message's id, or null when there is no team chat */
  notifyTeam: (html: string) => Promise<number | null>;
  create?: CreateMessage;
  now?: Date;
}

export interface SalesReply {
  replies: string[];
  askPhone: boolean;
}

function teamMessage(chat: SalesChat, kind: string, summary: string): string {
  const who = [chat.name ? `<b>${esc(chat.name)}</b>` : "<b>?</b>", chat.username ? `@${esc(chat.username)}` : ""].filter(Boolean).join(" ");
  const phone = chat.phone ? `📞 +${chat.phone}` : "📞 —";
  const title = kind === "lead" ? "🤖 Sabaq: yangi mijoz" : "🤖 Sabaq: savol";
  return `${title}\n${who}\n${phone}\n\n${esc(summary.slice(0, 1500))}\n\n↩️ Javob uchun shu xabarga reply qiling: javobingiz unga boradi.`;
}

function siteUrl(): string | null {
  const u = mainSiteUrl() ?? rawAppUrl();
  return u && u.startsWith("https://") ? u.replace(/\/$/, "") : null;
}

export async function handleSalesMessage(h: SalesInput): Promise<SalesReply> {
  const now = h.now ?? new Date();
  const say = (k: keyof typeof TEXT): SalesReply => ({ replies: [salesText(k, h.locale)], askPhone: false });
  if (!h.create && !anthropicApiKey()) return say("paused");
  const chat = await db.salesChat.findUniqueOrThrow({ where: { id: h.chatRowId } });

  const rateKey = attemptKey.agentChat(chat.chatId);
  const verdict = await checkAttempts(dbAttemptStore, [{ key: rateKey, rule: RULES.agentChat }], now);
  if (!verdict.allowed) return say("tooMany");
  await recordAttempt(dbAttemptStore, [rateKey], false, now);

  const month = monthKey(todayISO(now));
  const used = await db.salesUsage.findUnique({ where: { month } });
  if (used && capTokens(used) >= salesMonthlyTokenCap()) return say("paused");

  const stored = (chat.messages ?? []) as unknown as AgentMessage[];
  const history = trimHistory(stored, HISTORY_LIMITS);
  const before = stored.slice(0, stored.length - history.length);
  const site = siteUrl();
  const demo = demoHref();
  const system = buildSalesPrompt({
    name: BRAND.name,
    siteUrl: site,
    // demoHref is a full DEMO_URL or "/demo" on a demo server
    demoUrl: demo ? (demo.startsWith("/") ? (site ? `${site}${demo}` : null) : demo) : null,
    signupOpen: !signupClosed(),
  });
  const state = { awaitingPhone: chat.awaitingPhone, phone: chat.phone };
  const turnSystem = async () => `<holat>Telefon raqam: ${state.phone ? "olingan" : state.awaitingPhone ? "so'ralgan, hali kelmagan" : "yo'q"}. Bugun: ${todayISO(now)}.</holat>`;

  const meter = async (u: TurnUsage) => {
    const tokens = { inputTokens: u.input, outputTokens: u.output, cacheReadTokens: u.cacheRead, cacheWriteTokens: u.cacheWrite };
    const add = Object.fromEntries(Object.entries(tokens).map(([k, v]) => [k, { increment: v }]));
    await db.$transaction([
      db.salesUsage.upsert({ where: { month }, create: { month, ...tokens, calls: 1 }, update: { ...add, calls: { increment: 1 } } }),
      db.salesChat.update({ where: { id: chat.id }, data: add }),
    ]);
  };

  const execute = async (name: string, input: Record<string, unknown>): Promise<unknown> => {
    if (name === "request_phone") {
      if (state.phone) return { ok: true, note: "raqam allaqachon olingan" };
      state.awaitingPhone = true;
      await db.salesChat.update({ where: { id: chat.id }, data: { awaitingPhone: true } });
      return { ok: true, note: "tugma ko'rsatildi" };
    }
    if (name === "notify_team") {
      const kind = input.kind === "question" ? "question" : "lead";
      const summary = typeof input.summary === "string" ? input.summary.trim() : "";
      if (!summary) throw new AgentToolError("summary bo'sh: jamoa uchun qisqa xulosa yoz");
      const fresh = await db.salesChat.findUniqueOrThrow({ where: { id: chat.id } });
      const id = await h.notifyTeam(teamMessage(fresh, kind, summary));
      if (id === null) throw new AgentToolError("jamoaga hozir yuborib bo'lmadi: odamga jamoa keyinroq bog'lanishini ayt");
      await db.salesChat.update({ where: { id: chat.id }, data: { teamMessageIds: { push: id } } });
      return { ok: true };
    }
    throw new AgentToolError(`noma'lum vosita: ${name}`);
  };

  const replies: string[] = [];
  try {
    const r = await runTurn({
      create: h.create ?? defaultCreate(),
      model: agentModel(),
      system,
      tools: SALES_TOOLS,
      history,
      userText: h.text,
      turnSystem,
      execute,
      onUsage: meter,
      onReply: (t) => replies.push(t),
    });
    await saveHistory(chat.id, [...before, ...r.history], now);
    if (r.stopped === "refusal" || !replies.length) return { replies: [...replies, salesText("error", h.locale)], askPhone: false };
    return { replies, askPhone: state.awaitingPhone && !state.phone };
  } catch (e) {
    console.error("[sales] turn failed", e);
    await saveHistory(chat.id, [...stored, { role: "user", content: h.text }], now);
    return say("error");
  }
}

async function saveHistory(id: string, messages: AgentMessage[], now: Date): Promise<void> {
  const kept = trimHistory(stripThinking(messages), STORED_LIMITS);
  await db.salesChat.update({ where: { id }, data: { messages: JSON.parse(JSON.stringify(kept)), lastMessageAt: now } });
}

/** A team member replied to a "🤖 Sabaq" notification: the conversation it belongs to, or null. */
export async function salesChatOfTeamMessage(messageId: number): Promise<SalesChat | null> {
  return db.salesChat.findFirst({ where: { teamMessageIds: { has: messageId } }, orderBy: { lastMessageAt: "desc" } });
}

