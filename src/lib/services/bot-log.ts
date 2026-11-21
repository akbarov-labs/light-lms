// The conversation log: every message of a center's AI chats (the lead agent and the tutor) as the person
// saw it, for the owner (and the platform team) to read on /conversations. Writing never breaks a chat: a
// failed write is logged and dropped. Entries older than BOT_LOG_DAYS are deleted by the nightly job.
import { db } from "@/lib/db";
import type { BotChatKind, BotMessageFrom } from "@/generated/prisma/client";

export const BOT_LOG_DAYS = 90;
/** Longest text kept per message: a whole reply, never a runaway one. */
const MAX_TEXT = 8_000;

export interface BotLogEntry {
  from: BotMessageFrom;
  text: string;
  name?: string | null;
}

/** Telegram HTML (<b>, <a href>, &lt;…) → the plain text the person read. */
export function plainText(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

export async function logBotMessages(centerId: string, chatId: string, kind: BotChatKind, entries: BotLogEntry[], now = new Date()): Promise<void> {
  const rows = entries
    .map((e) => ({ ...e, text: e.text.trim().slice(0, MAX_TEXT) }))
    .filter((e) => e.text)
    // one millisecond apart, so the order survives sorting by time
    .map((e, i) => ({ centerId, chatId, kind, from: e.from, name: e.name?.slice(0, 120) ?? null, text: e.text, createdAt: new Date(now.getTime() + i) }));
  if (!rows.length) return;
  try {
    await db.botMessage.createMany({ data: rows });
  } catch (e) {
    console.error("[bot-log] write failed", e);
  }
}

export interface ConversationRow {
  chatId: string;
  kind: BotChatKind;
  name: string | null;
  messages: number;
  lastAt: Date;
  lastText: string;
  lastFrom: BotMessageFrom;
}

/** A center's conversations, newest first: one row per chat and bot, with its last message. */
export async function listConversations(centerId: string, opts: { kind?: BotChatKind; since?: Date; take?: number } = {}): Promise<ConversationRow[]> {
  const where = { centerId, ...(opts.kind ? { kind: opts.kind } : {}), ...(opts.since ? { createdAt: { gte: opts.since } } : {}) };
  const groups = await db.botMessage.groupBy({
    by: ["chatId", "kind"],
    where,
    _count: { _all: true },
    _max: { createdAt: true },
    orderBy: { _max: { createdAt: "desc" } },
    take: opts.take ?? 100,
  });
  if (!groups.length) return [];
  // the last message of each, and the person's name from their newest message that has one
  const last = await db.botMessage.findMany({
    where: { centerId, OR: groups.map((g) => ({ chatId: g.chatId, kind: g.kind, createdAt: g._max.createdAt! })) },
    select: { chatId: true, kind: true, text: true, from: true },
  });
  const named = await db.botMessage.findMany({
    where: { centerId, from: "PERSON", name: { not: null }, OR: groups.map((g) => ({ chatId: g.chatId, kind: g.kind })) },
    orderBy: { createdAt: "desc" },
    distinct: ["chatId", "kind"],
    select: { chatId: true, kind: true, name: true },
  });
  const key = (r: { chatId: string; kind: BotChatKind }) => `${r.kind}:${r.chatId}`;
  const lastBy = new Map(last.map((r) => [key(r), r]));
  const nameBy = new Map(named.map((r) => [key(r), r.name]));
  return groups.map((g) => {
    const l = lastBy.get(key(g));
    return { chatId: g.chatId, kind: g.kind, name: nameBy.get(key(g)) ?? null, messages: g._count._all, lastAt: g._max.createdAt!, lastText: l?.text ?? "", lastFrom: l?.from ?? "PERSON" };
  });
}

/** One conversation, oldest first (the newest `take` messages). */
export async function conversation(centerId: string, chatId: string, kind: BotChatKind, take = 500) {
  const rows = await db.botMessage.findMany({
    where: { centerId, chatId, kind },
    orderBy: { createdAt: "desc" },
    take,
    select: { id: true, from: true, name: true, text: true, createdAt: true },
  });
  return rows.reverse();
}

/** Nightly: drop what is older than BOT_LOG_DAYS. */
export async function pruneBotLog(now = new Date(), days = BOT_LOG_DAYS): Promise<number> {
  const before = new Date(now.getTime() - days * 86_400_000);
  return (await db.botMessage.deleteMany({ where: { createdAt: { lt: before } } })).count;
}
