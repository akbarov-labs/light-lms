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
import { buildOnboardingPrompt, buildSalesPrompt } from "./prompt";
import { draftSummary, mergeDraft, missingItems, readOnboarding, type Onboarding, type OnboardingFile } from "./onboarding";

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

const REQUEST_PHONE: AgentTool = {
  name: "request_phone",
  description: "Odamga Telegram'da «Raqamni yuborish» tugmasini ko'rsatadi. Faqat jamoa bog'lanishi kerak bo'lganda (boshlash, demo, qo'ng'iroq), markazga ulanish yoki markaz egasining kirish raqami uchun.",
  input_schema: { type: "object", properties: {}, additionalProperties: false },
};

const NOTIFY_TEAM: AgentTool = {
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
};

export const SALES_TOOLS: AgentTool[] = [
  REQUEST_PHONE,
  NOTIFY_TEAM,
  {
    name: "start_onboarding",
    description: "Markazni shu chatda sozlashni boshlaydi (odam rozi bo'lgandan keyin). Keyingi xabarlardan savol-javob rejimi.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
];

const nameList = (extra: Record<string, unknown> = {}) => ({ type: "array", items: { type: "object", properties: { name: { type: "string" }, ...extra }, required: ["name"] } });

export const ONBOARDING_TOOLS: AgentTool[] = [
  REQUEST_PHONE,
  NOTIFY_TEAM,
  {
    name: "save_onboarding",
    description:
      "Markaz qoralamasiga bo'limlarni yozadi. Ro'yxat bo'limi (branches, courses, teachers, groups, notes) to'liq almashtiriladi: eski elementlarni ham yubor. Obyekt bo'limlari maydonma-maydon qo'shiladi. Bo'limni o'chirish: null. Natijada «hali kerak» ro'yxati qaytadi.",
    input_schema: {
      type: "object",
      properties: {
        center: { type: "object", properties: { name: { type: "string" }, city: { type: "string" }, phone: { type: "string", description: "markazning ochiq telefoni, bo'lsa" } } },
        owner: { type: "object", properties: { name: { type: "string" }, role: { type: "string" } } },
        branches: nameList({ address: { type: "string" }, rooms: { type: "array", items: { type: "string" } } }),
        courses: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              pricing: { type: "string", enum: ["monthly", "package"] },
              price: { type: "integer", description: "so'm, butun son" },
              lessonsPerWeek: { type: "integer" },
              lessonMinutes: { type: "integer" },
              packageLessons: { type: "integer", description: "paketdagi darslar soni (pricing=package)" },
            },
            required: ["name", "pricing", "price"],
          },
        },
        teachers: nameList({
          phone: { type: "string" },
          salary: {
            type: "object",
            properties: {
              model: {
                type: "string",
                enum: ["PERCENT_EARNED", "FIXED", "PER_LESSON", "BASE_PLUS_PERCENT"],
                description: "PERCENT_EARNED: to'langan puldan foiz; FIXED: belgilangan oylik; PER_LESSON: har dars uchun; BASE_PLUS_PERCENT: oylik + foiz",
              },
              percent: { type: "integer" },
              fixedAmount: { type: "integer" },
              perLesson: { type: "integer" },
            },
            required: ["model"],
          },
        }),
        groups: {
          type: "array",
          items: {
            type: "object",
            properties: {
              name: { type: "string" },
              course: { type: "string", description: "courses dagi nom" },
              teacher: { type: "string", description: "teachers dagi ism yoki egasining ismi" },
              branch: { type: "string" },
              room: { type: "string" },
              days: { type: "array", items: { type: "integer", minimum: 1, maximum: 7 } },
              startTime: { type: "string", description: "HH:MM" },
              endTime: { type: "string", description: "HH:MM" },
              startDate: { type: "string", description: "YYYY-MM-DD, yangi guruh bo'lsa" },
            },
            required: ["name", "course", "teacher", "days", "startTime", "endTime"],
          },
        },
        students: { type: "object", properties: { count: { type: "integer" }, source: { type: "string", enum: ["file", "photo", "typed", "later"] }, note: { type: "string" } } },
        rules: {
          type: "object",
          properties: {
            trialLessons: { type: "integer", description: "bepul sinov darslari soni" },
            excusedAbsenceCredit: { type: "boolean", description: "sababli qoldirilgan dars puli qaytariladimi" },
            payFromCollected: { type: "boolean", description: "true: o'qituvchi oyligi yig'ilgan puldan; false: o'tilgan darslardan" },
            reminderDaysBefore: { type: "integer", description: "to'lovni necha kun oldin eslatish" },
            other: { type: "string" },
          },
        },
        homework: { type: "object", properties: { wanted: { type: "boolean" }, note: { type: "string" } } },
        notes: { type: "array", items: { type: "string" } },
      },
      additionalProperties: false,
    },
  },
  {
    name: "show_summary",
    description: "Qoralamaning to'liq xulosasini odamga alohida xabar qilib yuboradi (sen qayta yozma). Keyin tasdiqlashni so'ra.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "finish_onboarding",
    description: "Odam xulosani tasdiqladi: qoralama va fayllar jamoaga yuboriladi, jamoa markazni ochadi. Faqat show_summary dan keyin va odam «ha» deganda.",
    input_schema: { type: "object", properties: {}, additionalProperties: false },
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
  /** copies the person's files (their own messages) into the team chat */
  sendFilesToTeam?: (files: OnboardingFile[]) => Promise<void>;
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

function onboardingTeamMessage(chat: SalesChat, o: Onboarding): string {
  const who = [chat.name ? `<b>${esc(chat.name)}</b>` : "<b>?</b>", chat.username ? `@${esc(chat.username)}` : ""].filter(Boolean).join(" ");
  const summary = draftSummary(o.draft, o.files, !!chat.phone);
  return [
    "🏫 Sabaq: markaz sozlash so'rovi",
    who,
    chat.phone ? `📞 +${chat.phone}` : "📞 —",
    "",
    `<pre>${esc(summary.slice(0, 3000))}</pre>`,
    "",
    `Tekshirib, serverda: <code>scripts/create-from-onboarding.ts ${chat.id}</code> (avval --dry-run).`,
    "↩️ Shu xabarga reply qilsangiz, javobingiz egasiga boradi.",
  ].join("\n");
}

/** Writes status/draft over the stored state, so files the bot saved meanwhile are kept. */
async function saveOnboarding(id: string, patch: Partial<Pick<Onboarding, "status" | "draft">>): Promise<Onboarding> {
  const row = await db.salesChat.findUniqueOrThrow({ where: { id }, select: { onboarding: true } });
  const o = { ...readOnboarding(row.onboarding), ...patch };
  await db.salesChat.update({ where: { id }, data: { onboarding: JSON.parse(JSON.stringify(o)) } });
  return o;
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
  // the mode is fixed for the whole turn: start_onboarding takes effect from the person's next message
  let onboarding = readOnboarding(chat.onboarding);
  const setup = onboarding.status === "collecting" || onboarding.status === "submitted";
  const system = setup
    ? buildOnboardingPrompt({ name: BRAND.name })
    : buildSalesPrompt({
        name: BRAND.name,
        siteUrl: site,
        // demoHref is a full DEMO_URL or "/demo" on a demo server
        demoUrl: demo ? (demo.startsWith("/") ? (site ? `${site}${demo}` : null) : demo) : null,
        signupOpen: !signupClosed(),
      });
  const state = { awaitingPhone: chat.awaitingPhone, phone: chat.phone };
  const phoneText = () => (state.phone ? "olingan" : state.awaitingPhone ? "so'ralgan, hali kelmagan" : "yo'q");
  const turnSystem = async () => {
    if (!setup) return `<holat>Telefon raqam: ${phoneText()}. Bugun: ${todayISO(now)}.</holat>`;
    const missing = missingItems(onboarding.draft, !!state.phone);
    const stage = onboarding.status === "submitted" ? "jamoaga yuborilgan (tuzatish bo'lsa, qayta yuborish mumkin)" : "ma'lumot yig'ilmoqda";
    return `<holat>Markaz sozlash: ${stage}. Telefon raqam: ${phoneText()}. Fayllar: ${onboarding.files.length} ta. Hali kerak: ${missing.length ? missing.join("; ") : "hammasi bor"}. Bugun: ${todayISO(now)}.</holat>`;
  };

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
    if (name === "start_onboarding" && !setup) {
      onboarding = await saveOnboarding(chat.id, { status: "collecting" });
      return { ok: true, note: "boshlandi: endi markaz nomi va shahrini so'ra" };
    }
    if (setup && name === "save_onboarding") {
      const r = mergeDraft(onboarding.draft, input);
      if (!r.ok) throw new AgentToolError(`saqlanmadi: ${r.errors.join("; ")}. Tuzatib qayta yubor.`);
      onboarding = await saveOnboarding(chat.id, { draft: r.draft });
      return { ok: true, missing: missingItems(r.draft, !!state.phone) };
    }
    if (setup && name === "show_summary") {
      const row = await db.salesChat.findUniqueOrThrow({ where: { id: chat.id }, select: { onboarding: true } });
      onboarding = { ...readOnboarding(row.onboarding), draft: onboarding.draft };
      replies.push(draftSummary(onboarding.draft, onboarding.files, !!state.phone));
      return { shown: true, missing: missingItems(onboarding.draft, !!state.phone) };
    }
    if (setup && name === "finish_onboarding") {
      const fresh = await db.salesChat.findUniqueOrThrow({ where: { id: chat.id } });
      const basics = [!onboarding.draft.center?.name && "markaz nomi", !onboarding.draft.owner?.name && "egasining ismi", !fresh.phone && "egasining telefoni (request_phone)"].filter(Boolean);
      if (basics.length) throw new AgentToolError(`hali yuborib bo'lmaydi, kerak: ${basics.join(", ")}`);
      // files arrive outside the turn (the bot saves them): take the stored list, not this turn's copy
      const next: Onboarding = { ...readOnboarding(fresh.onboarding), draft: onboarding.draft, status: "submitted", submittedAt: now.toISOString() };
      const id = await h.notifyTeam(onboardingTeamMessage(fresh, next));
      if (id === null) throw new AgentToolError("jamoaga hozir yuborib bo'lmadi: odamga jamoa keyinroq bog'lanishini ayt");
      await h.sendFilesToTeam?.(next.files).catch((e) => console.error("[sales] files to team", e));
      onboarding = next;
      await db.salesChat.update({ where: { id: chat.id }, data: { onboarding: JSON.parse(JSON.stringify(next)), teamMessageIds: { push: id } } });
      return { ok: true, note: "jamoaga yuborildi" };
    }
    throw new AgentToolError(`noma'lum vosita: ${name}`);
  };

  const replies: string[] = [];
  try {
    const r = await runTurn({
      create: h.create ?? defaultCreate(),
      model: agentModel(),
      system,
      tools: setup ? ONBOARDING_TOOLS : SALES_TOOLS,
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


export const MAX_ONBOARDING_FILES = 50;

/**
 * A file sent during center setup: kept as its Telegram file id (no copy on our disk) and later copied to
 * the team chat. Returns the marker the model hears instead of the file, or null when the chat is not
 * setting up a center (the bot then ignores the file).
 */
export async function recordOnboardingFile(chatRowId: string, file: OnboardingFile): Promise<string | null> {
  const row = await db.salesChat.findUniqueOrThrow({ where: { id: chatRowId }, select: { onboarding: true } });
  const o = readOnboarding(row.onboarding);
  if (o.status !== "collecting" && o.status !== "submitted") return null;
  if (o.files.length >= MAX_ONBOARDING_FILES) return `[fayl olinmadi: ${MAX_ONBOARDING_FILES} tadan ko'p fayl. Qolganini jamoa bilan alohida hal qilamiz]`;
  o.files.push(file);
  await db.salesChat.update({ where: { id: chatRowId }, data: { onboarding: JSON.parse(JSON.stringify(o)), lastMessageAt: new Date() } });
  const caption = file.caption ? ` — izoh: «${file.caption.slice(0, 300).replace(/»/g, '"')}»` : "";
  return `[fayl olindi: ${file.name}${file.mime ? ` (${file.mime})` : ""}${caption}]`;
}
