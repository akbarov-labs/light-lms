// The math tutor as a service: everything between "a linked family chat wrote a math question" and "this is
// the reply". No Telegram here (src/worker/bot/tutor.ts does that), so tests run it with a scripted model.
//
// Order of checks on every message: a linked student or parent of a center with tutor.enabled (and an API
// key) → a pasted sheet is refused by code → the center's monthly token cap (shared with the lead agent and
// homework photos, AgentUsage) → the chat's daily message limit → the model → metering → the answer-key guard
// (a reply that gives away an open homework's key is replaced) → saving the last turns.
import Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { anthropicApiKey, tutorModel } from "@/lib/env";
import { readSettings } from "@/lib/settings";
import { monthKey, todayISO } from "@/lib/dates";
import { makeT, type Locale } from "@/lib/i18n";
import { validLinks } from "@/lib/telegram-links";
import { capTokens } from "@/lib/agent/service";
import { scriptOf } from "@/lib/agent/prompt";
import { fallbackParams, type CreateMessage } from "@/lib/agent/loop";
import { windowOf } from "@/lib/services/homework";
import { leakedQuestion, looksLikeSheet } from "./guard";
import { TUTOR_SYSTEM, turnNote } from "./prompt";
import { TUTOR_HISTORY, nextDayCount, toTelegramHtml, trimTurns, type TutorMessage } from "./turns";

/** One message from the student: longer is cut (a pasted page is not a question). */
export const MAX_QUESTION_CHARS = 2000;

// ------------------------------------------------------------------ who may use it

export interface TutorTarget {
  centerId: string;
  dailyMessages: number;
  /** the students this chat speaks for in that center */
  studentIds: string[];
  grades: (number | null)[];
  /** linked as a guardian only (asking for a child) */
  parent: boolean;
}

let override: CreateMessage | null = null;

/** For tests: replace the model call (null = the Anthropic API). */
export function setTutorModel(create: CreateMessage | null) {
  override = create;
}

let client: Anthropic | null = null;
function defaultCreate(): CreateMessage {
  client ??= new Anthropic({ apiKey: anthropicApiKey() });
  const c = client;
  return (p) => c.beta.messages.create(p);
}

/**
 * The center whose tutor answers this chat, or null: the chat must be a linked student or parent (validLinks:
 * re-checked every time, scoped to a center's own bot) of a center with tutor.enabled, and the model must be
 * reachable. With students in two such centers, the first one (by student name) answers.
 */
export async function tutorFor(chatId: string): Promise<TutorTarget | null> {
  if (!override && !anthropicApiKey()) return null;
  const links = await validLinks(chatId);
  if (links.guardianIds.length === 0 && links.studentIds.length === 0) return null;
  const guardians = await db.guardian.findMany({ where: { id: { in: links.guardianIds } }, select: { familyId: true } });
  const students = await db.student.findMany({
    where: { status: "ACTIVE", center: { disabledAt: null }, OR: [{ familyId: { in: guardians.map((g) => g.familyId) } }, { id: { in: links.studentIds } }] },
    select: { id: true, centerId: true, schoolGrade: true, center: { select: { settings: true } } },
    orderBy: [{ firstName: "asc" }, { id: "asc" }],
  });
  const first = students.find((s) => readSettings(s.center.settings).tutor.enabled);
  if (!first) return null;
  const mine = students.filter((s) => s.centerId === first.centerId);
  return {
    centerId: first.centerId,
    dailyMessages: readSettings(first.center.settings).tutor.dailyMessages,
    studentIds: mine.map((s) => s.id),
    grades: mine.map((s) => s.schoolGrade),
    parent: !mine.some((s) => links.studentIds.includes(s.id)),
  };
}

/**
 * Answer keys (Homework.answers) of these students' groups whose deadline has not passed: still to be set
 * (the key typed before the lesson ended), open, or in the late window. The guard checks replies against them.
 */
export async function openKeysFor(studentIds: string[], now = new Date()): Promise<string[][]> {
  if (studentIds.length === 0) return [];
  const since = new Date(now.getTime() - 45 * 86_400_000);
  const enrollments = await db.enrollment.findMany({
    where: { studentId: { in: studentIds }, OR: [{ endDate: null }, { endDate: { gte: since } }] },
    select: { groupId: true },
  });
  const homeworks = await db.homework.findMany({
    where: { groupId: { in: [...new Set(enrollments.map((e) => e.groupId))] }, lesson: { date: { gte: since } } },
    select: { answers: true, center: { select: { settings: true } }, lesson: { select: { id: true, groupId: true, date: true, startTime: true, endTime: true } } },
  });
  const keys: string[][] = [];
  for (const hw of homeworks) {
    const w = await windowOf(hw.lesson, readSettings(hw.center.settings).homework);
    const closesAt = w.lateUntil ?? w.dueAt;
    if (!closesAt || now < closesAt) keys.push(hw.answers);
  }
  return keys;
}

// ------------------------------------------------------------------ one turn

export type TutorOutcome = "reply" | "off" | "sheet" | "paused" | "limit" | "refused" | "error" | "leak";

export interface TutorReply {
  outcome: TutorOutcome;
  /** HTML for Telegram (parse_mode HTML) */
  html: string;
  /** the question number whose key was in the model's reply (outcome "leak") */
  leakedQ?: number;
}

export interface TutorInput {
  chatId: string;
  text: string;
  locale: Locale;
  now?: Date;
}

export async function handleTutorMessage(h: TutorInput): Promise<TutorReply> {
  const now = h.now ?? new Date();
  const t = makeT(h.locale);
  const say = (outcome: TutorOutcome, html: string, extra: Partial<TutorReply> = {}): TutorReply => ({ outcome, html, ...extra });
  const target = await tutorFor(h.chatId);
  if (!target) return say("off", t("tutor.off"));
  const text = h.text.trim().slice(0, MAX_QUESTION_CHARS);
  if (looksLikeSheet(text)) return say("sheet", t("tutor.sheet"));

  const settings = readSettings((await db.center.findUniqueOrThrow({ where: { id: target.centerId }, select: { settings: true } })).settings);
  const month = monthKey(todayISO(now));
  const used = await db.agentUsage.findUnique({ where: { centerId_month: { centerId: target.centerId, month } } });
  if (used && capTokens(used) >= settings.agent.monthlyTokenCap) return say("paused", t("tutor.paused"));

  const row = await db.tutorChat.upsert({
    where: { centerId_chatId: { centerId: target.centerId, chatId: h.chatId } },
    create: { centerId: target.centerId, chatId: h.chatId },
    update: {},
  });
  const today = todayISO(now);
  const next = nextDayCount(row, today, target.dailyMessages);
  if (next === null) return say("limit", t("tutor.dailyLimit", { n: target.dailyMessages }));
  // a new day resets; otherwise the slot is taken only while the count is still below the limit
  const took =
    next === 1 && row.day !== today
      ? await db.tutorChat.updateMany({ where: { id: row.id, day: row.day }, data: { day: today, dayMessages: 1 } })
      : await db.tutorChat.updateMany({ where: { id: row.id, day: today, dayMessages: { lt: target.dailyMessages } }, data: { dayMessages: { increment: 1 } } });
  if (took.count === 0) return say("limit", t("tutor.dailyLimit", { n: target.dailyMessages }));

  const history = trimTurns((row.messages ?? []) as unknown as TutorMessage[], TUTOR_HISTORY - 1);
  const model = tutorModel();
  let res: Anthropic.Beta.BetaMessage;
  try {
    res = await (override ?? defaultCreate())({
      model,
      // thinking is always on (Opus 5.5) and counts against max_tokens; the reply itself is short
      max_tokens: 16_000,
      system: [{ type: "text", text: TUTOR_SYSTEM, cache_control: { type: "ephemeral" } }],
      messages: [
        ...history,
        { role: "user", content: text },
        { role: "system", content: turnNote({ grades: target.grades, parent: target.parent, script: scriptOf(text) }) },
      ],
      cache_control: { type: "ephemeral" },
      output_config: { effort: "medium" },
      ...fallbackParams(model),
    });
  } catch (e) {
    console.error("[tutor] model call failed", e);
    return say("error", t("tutor.error"));
  }

  const u = res.usage;
  const tokens = { inputTokens: u.input_tokens, outputTokens: u.output_tokens, cacheReadTokens: u.cache_read_input_tokens ?? 0, cacheWriteTokens: u.cache_creation_input_tokens ?? 0 };
  const add = Object.fromEntries(Object.entries(tokens).map(([k, v]) => [k, { increment: v }]));
  await db.$transaction([
    db.agentUsage.upsert({
      where: { centerId_month: { centerId: target.centerId, month } },
      create: { centerId: target.centerId, month, ...tokens, calls: 1 },
      update: { ...add, calls: { increment: 1 } },
    }),
    db.tutorChat.update({ where: { id: row.id }, data: { ...add, lastMessageAt: now } }),
  ]);

  // a refused answer is not kept: the next message starts from the history before it
  if (res.stop_reason === "refusal") return say("refused", t("tutor.refused"));
  const reply = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("\n").trim();
  if (!reply) return say("error", t("tutor.error"));

  // the guard: the student's recent messages say which question they mean ("5-misol"), the keys say its answer
  const asked = [...history.filter((m) => m.role === "user").map((m) => m.content), text].join("\n");
  const leakedQ = leakedQuestion(reply, await openKeysFor(target.studentIds, now), asked);
  const kept = leakedQ === null ? reply : t("tutor.leak");
  if (leakedQ !== null) console.warn(`[tutor] reply replaced: open homework key, chat=${row.id} q=${leakedQ}`);
  const messages = trimTurns([...history, { role: "user", content: text }, { role: "assistant", content: kept }]);
  await db.tutorChat.update({
    where: { id: row.id },
    data: { messages: JSON.parse(JSON.stringify(messages)), ...(leakedQ !== null ? { blockedReplies: { increment: 1 } } : {}) },
  });
  return leakedQ === null ? say("reply", toTelegramHtml(reply)) : say("leak", kept, { leakedQ });
}
