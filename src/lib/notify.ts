// Notification queue (HANDOFF §9): rows are written in the same transaction as the event and
// sent by the worker with a rate limit. Nothing here talks to Telegram directly.
import type { Tx } from "./db";
import type { Locale } from "./i18n";

export interface Chat {
  chatId: string;
  locale: Locale;
}

async function chatLocales(tx: Tx, chatIds: string[]): Promise<Map<string, Locale>> {
  if (chatIds.length === 0) return new Map();
  const links = await tx.telegramLink.findMany({ where: { chatId: { in: chatIds } }, select: { chatId: true, locale: true } });
  return new Map(links.map((l) => [l.chatId, l.locale === "ru" ? "ru" : "uz"]));
}

/** Telegram chats of a family: every linked guardian, plus linked students. */
export async function familyChats(tx: Tx, familyId: string, studentId?: string | null): Promise<Chat[]> {
  const [guardians, students] = await Promise.all([
    tx.guardian.findMany({ where: { familyId, telegramChatId: { not: null } }, select: { telegramChatId: true } }),
    tx.student.findMany({ where: { familyId, telegramChatId: { not: null }, ...(studentId ? { id: studentId } : {}) }, select: { telegramChatId: true } }),
  ]);
  const ids = [...new Set([...guardians, ...students].map((x) => x.telegramChatId!))];
  const locales = await chatLocales(tx, ids);
  return ids.map((chatId) => ({ chatId, locale: locales.get(chatId) ?? "uz" }));
}

export async function staffChat(tx: Tx, userId: string): Promise<Chat | null> {
  const u = await tx.user.findUnique({ where: { id: userId }, select: { telegramChatId: true, locale: true } });
  if (!u?.telegramChatId) return null;
  return { chatId: u.telegramChatId, locale: u.locale === "ru" ? "ru" : "uz" };
}

/** Queue one message per chat. dedupeKey (per chat) makes re-runs of a job harmless. */
export async function enqueue(tx: Tx, centerId: string, chats: Chat[], text: (l: Locale) => string, dedupeKey?: string): Promise<number> {
  if (chats.length === 0) return 0;
  const res = await tx.notification.createMany({
    data: chats.map((c) => ({ centerId, chatId: c.chatId, text: text(c.locale), dedupeKey: dedupeKey ? `${dedupeKey}:${c.chatId}` : null })),
    skipDuplicates: true,
  });
  return res.count;
}
