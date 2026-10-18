// Notification queue (HANDOFF §9): rows are written in the same transaction as the event and
// sent by the worker with a rate limit. Nothing here talks to Telegram directly.
import type { Tx } from "./db";
import type { Locale } from "./i18n";
import { readSettings, type SmsEvent } from "./settings";
import { htmlToSms } from "./sms/text";
import { telegramBotToken } from "./env";

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

// ---------------------------------------------------------------- SMS (v2)

export interface SmsTarget {
  phone: string;
  locale: Locale;
}

/**
 * Who gets an SMS for this family event, or null when none should be sent: the center has no SMS
 * account or the event switched off, or (onlyWithoutTelegram) the family already reads Telegram.
 * One SMS per family — to the primary guardian, else the first guardian with a phone, else the
 * student — SMS costs the center money; Telegram goes to every linked chat.
 */
export async function familySmsTarget(tx: Tx, centerId: string, familyId: string, event: SmsEvent, studentId?: string | null, hasTelegram = false): Promise<SmsTarget | null> {
  const c = await tx.center.findUnique({ where: { id: centerId }, select: { smsLogin: true, smsPassword: true, settings: true, locale: true, disabledAt: true } });
  if (!c?.smsLogin || !c.smsPassword || c.disabledAt) return null;
  const s = readSettings(c.settings).sms;
  if (!s[event] || (s.onlyWithoutTelegram && hasTelegram)) return null;
  const guardians = await tx.guardian.findMany({ where: { familyId }, select: { phone: true, isPrimary: true }, orderBy: [{ isPrimary: "desc" }, { id: "asc" }] });
  let phone = guardians.find((g) => /^998\d{9}$/.test(g.phone))?.phone ?? null;
  if (!phone) {
    const st = await tx.student.findFirst({ where: { familyId, phone: { not: null }, ...(studentId ? { id: studentId } : {}) }, select: { phone: true } });
    phone = st?.phone && /^998\d{9}$/.test(st.phone) ? st.phone : null;
  }
  return phone ? { phone, locale: c.locale === "ru" ? "ru" : "uz" } : null;
}

/** Queue one SMS (plain text from the Telegram HTML). dedupeKey makes re-runs harmless, like enqueue(). */
export async function enqueueSms(tx: Tx, centerId: string, target: SmsTarget, text: (l: Locale) => string, dedupeKey?: string): Promise<number> {
  const res = await tx.notification.createMany({
    data: [{ centerId, channel: "SMS", chatId: target.phone, text: htmlToSms(text(target.locale)), dedupeKey: dedupeKey ? `${dedupeKey}:sms:${target.phone}` : null }],
    skipDuplicates: true,
  });
  return res.count;
}

/**
 * A family message: Telegram to every linked chat of the family (or of `studentId` + guardians),
 * plus an SMS when the center turned SMS on for `event`. Returns the number of rows queued.
 */
export async function notifyFamily(
  tx: Tx,
  p: { centerId: string; familyId: string; studentId?: string | null; event: SmsEvent; text: (l: Locale) => string; dedupeKey?: string },
): Promise<number> {
  const chats = await familyChats(tx, p.familyId, p.studentId);
  let n = await enqueue(tx, p.centerId, chats, p.text, p.dedupeKey);
  // linked chats only count as "reads Telegram" when this installation has a bot to deliver them
  const target = await familySmsTarget(tx, p.centerId, p.familyId, p.event, p.studentId, chats.length > 0 && !!telegramBotToken());
  if (target) n += await enqueueSms(tx, p.centerId, target, p.text, p.dedupeKey);
  return n;
}
