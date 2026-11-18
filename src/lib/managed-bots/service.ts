// A center's own Telegram bot (docs/TELEGRAM-MANAGED-BOTS.md): creation through a one-time code and
// Telegram's request_managed_bot button, status changes from Settings, who started which bot, and which
// bot a queued message goes through.
import { randomBytes } from "node:crypto";
import type { CenterBot } from "@/generated/prisma/client";
import { db } from "../db";
import { audit } from "../audit";
import { esc } from "../messages";
import { makeT } from "../i18n";
import { enqueue, type Chat } from "../notify";
import { telegramBotToken, telegramManagedBots } from "../env";
import { validLinks } from "../telegram-links";
import { UserError } from "../user-error";
import { setManagedBotAccess } from "./api";
import { withBotScope } from "./scope";

/** Managed bots are usable: the flag is on and there is a shared bot to manage them. */
export function managedBotsOn(): boolean {
  return telegramManagedBots() && !!telegramBotToken();
}

export const CODE_TTL_MS = 10 * 60_000;
/** Deep-link payload of a creation code in the shared bot: t.me/<bot>?start=nb_<code>. */
export const CODE_PREFIX = "nb_";
const CODE_RE = /^[A-Za-z0-9_-]{16}$/;

/** Statuses the worker polls; only ACTIVE carries the center's messages. */
export const RUNNING: CenterBot["status"][] = ["TESTING", "ACTIVE"];

export const botLink = (b: Pick<CenterBot, "username">) => `https://t.me/${b.username}`;

/** "Create our bot" in Settings: a fresh one-time code for this center (older unused codes are dropped). */
export async function createBotRequest(centerId: string, userId: string, now = new Date()): Promise<string> {
  const code = randomBytes(12).toString("base64url");
  await db.$transaction(async (tx) => {
    await tx.botCreateRequest.deleteMany({ where: { centerId, usedAt: null } });
    await tx.botCreateRequest.create({ data: { code, centerId, userId, expiresAt: new Date(now.getTime() + CODE_TTL_MS) } });
  });
  return code;
}

export type OpenResult =
  | { ok: true; centerId: string; centerName: string; slug: string }
  | { ok: false; reason: "expired" | "notOwner" | "hasBot" | "off" };

/**
 * The shared bot got /start nb_<code> from `chatId`. The code must be fresh and unused, managed bots on for
 * the center, and the chat must be the linked chat of the OWNER who made the code. Then the chat is stored
 * on the request: the managed_bot update that follows must come from this same Telegram user.
 */
export async function openBotRequest(code: string, chatId: string, now = new Date()): Promise<OpenResult> {
  if (!CODE_RE.test(code)) return { ok: false, reason: "expired" };
  const r = await db.botCreateRequest.findUnique({ where: { code } });
  if (!r || r.usedAt || r.expiresAt <= now) return { ok: false, reason: "expired" };
  const center = await db.center.findUnique({ where: { id: r.centerId }, select: { id: true, name: true, slug: true, disabledAt: true, ownBotAllowed: true, bot: true } });
  if (!center || center.disabledAt || !center.ownBotAllowed || !managedBotsOn()) return { ok: false, reason: "off" };
  if (center.bot && center.bot.status !== "GONE") return { ok: false, reason: "hasBot" };
  // the shared bot: no scope, so every center's links count here
  const links = await withBotScope(null, () => validLinks(chatId));
  const owner = links.staffIds.includes(r.userId) ? await db.user.findFirst({ where: { id: r.userId, centerId: r.centerId, role: "OWNER", archivedAt: null } }) : null;
  if (!owner) return { ok: false, reason: "notOwner" };
  await db.botCreateRequest.update({ where: { code }, data: { chatId } });
  return { ok: true, centerId: center.id, centerName: center.name, slug: center.slug };
}

/** A username Telegram will take: letters, digits and _, 5–32 characters, ending in "bot". */
export function suggestedUsername(slug: string): string {
  const base = slug.replace(/[^a-zA-Z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/^(\d)/, "c$1").slice(0, 28) || "center";
  return `${base.length < 2 ? `${base}_center` : base}_bot`.slice(0, 32);
}

export interface ManagedBotUpdate {
  /** the user who created the bot (or its new owner) */
  user: { id: number };
  bot: { id: number; username?: string; first_name: string };
}

export type UpdateResult =
  | { kind: "attached"; bot: CenterBot }
  | { kind: "owner"; bot: CenterBot }
  | { kind: "token"; bot: CenterBot }
  | { kind: "ignored" };

/**
 * Telegram's managed_bot update. A known bot: its token or owner changed. A new bot: attached to the center
 * whose creation code this same user opened in the last 10 minutes; anything else is ignored, so nobody can
 * hang a bot on a center without the checked request.
 */
export async function onManagedBotUpdate(u: ManagedBotUpdate, now = new Date()): Promise<UpdateResult> {
  const botId = String(u.bot.id);
  const userId = String(u.user.id);
  const known = await db.centerBot.findUnique({ where: { botId } });
  if (known) {
    // the managed_bot update and the managed_bot_created message both report a creation: the second is no change
    if (known.ownerTgId === userId && now.getTime() - known.createdAt.getTime() < 2 * 60_000) return { kind: "ignored" };
    const changes = { username: u.bot.username ?? known.username, name: u.bot.first_name || known.name };
    if (known.ownerTgId !== userId) {
      const bot = await db.$transaction(async (tx) => {
        const b = await tx.centerBot.update({ where: { botId }, data: { ...changes, ownerTgId: userId } });
        await audit(tx, { centerId: known.centerId, entity: "CenterBot", entityId: botId, action: "bot.owner", before: { ownerTgId: known.ownerTgId }, after: { ownerTgId: userId } });
        return b;
      });
      return { kind: "owner", bot };
    }
    return { kind: "token", bot: await db.centerBot.update({ where: { botId }, data: changes }) };
  }
  const req = await db.botCreateRequest.findFirst({ where: { chatId: userId, usedAt: null, expiresAt: { gt: now } }, orderBy: { createdAt: "desc" } });
  if (!req || !u.bot.username) return { kind: "ignored" };
  const bot = await db.$transaction(async (tx) => {
    const taken = await tx.botCreateRequest.updateMany({ where: { code: req.code, usedAt: null }, data: { usedAt: now } });
    if (taken.count === 0) return null;
    const existing = await tx.centerBot.findUnique({ where: { centerId: req.centerId } });
    if (existing && existing.status !== "GONE") return null;
    if (existing) await tx.centerBot.delete({ where: { botId: existing.botId } });
    const b = await tx.centerBot.create({ data: { botId, centerId: req.centerId, username: u.bot.username!, name: u.bot.first_name, ownerTgId: userId } });
    await audit(tx, { centerId: req.centerId, userId: req.userId, entity: "CenterBot", entityId: botId, action: "bot.create", after: { username: b.username, name: b.name } });
    return b;
  });
  if (!bot) return { kind: "ignored" };
  // only the owner can open it until "Launch" (the owner always can)
  await setManagedBotAccess(botId, true).catch((e) => console.warn("[managed-bots] access settings", botId, e?.description ?? e));
  return { kind: "attached", bot };
}

type Change = "launch" | "pause" | "resume";
const NEXT: Record<Change, { from: CenterBot["status"][]; to: CenterBot["status"]; restricted: boolean | null }> = {
  launch: { from: ["TESTING"], to: "ACTIVE", restricted: false },
  pause: { from: ["TESTING", "ACTIVE"], to: "PAUSED", restricted: null },
  resume: { from: ["PAUSED"], to: "ACTIVE", restricted: false },
};

/** Settings: launch (open to everyone), pause (back to the shared bot) or resume. OWNER only (caller checks). */
export async function changeBotStatus(centerId: string, userId: string, change: Change): Promise<CenterBot> {
  const bot = await db.centerBot.findUnique({ where: { centerId } });
  const step = NEXT[change];
  if (!bot || !step.from.includes(bot.status)) throw new UserError("ownBot.wrongState");
  // open access first: if Telegram refuses, nothing changed here
  if (step.restricted !== null) await setManagedBotAccess(bot.botId, step.restricted);
  return db.$transaction(async (tx) => {
    const b = await tx.centerBot.update({ where: { botId: bot.botId }, data: { status: step.to, lastError: null } });
    await audit(tx, { centerId, userId, entity: "CenterBot", entityId: bot.botId, action: `bot.${change}`, before: { status: bot.status }, after: { status: step.to } });
    return b;
  });
}

/** The worker could not read the token or the bot was deleted: stop using it, say why. */
export async function markBotGone(botId: string, error: string): Promise<void> {
  const bot = await db.centerBot.findUnique({ where: { botId } });
  if (!bot || bot.status === "GONE") return;
  await db.$transaction(async (tx) => {
    await tx.centerBot.update({ where: { botId }, data: { status: "GONE", lastError: error.slice(0, 500) } });
    await audit(tx, { centerId: bot.centerId, entity: "CenterBot", entityId: botId, action: "bot.gone", before: { status: bot.status }, after: { status: "GONE", error: error.slice(0, 200) } });
  });
}

/** Bots the worker should poll: TESTING/ACTIVE, center enabled and still on the allow-list. */
export async function runnableBots(): Promise<CenterBot[]> {
  if (!managedBotsOn()) return [];
  return db.centerBot.findMany({ where: { status: { in: RUNNING }, center: { disabledAt: null, ownBotAllowed: true } } });
}

/**
 * The center bot a queued message for `chatId` should go through, or null for the shared bot: the center
 * has an ACTIVE bot (enabled, allowed) and this person started it and hasn't blocked it.
 */
export async function routeBotFor(centerId: string, chatId: string): Promise<string | null> {
  if (!managedBotsOn()) return null;
  const bot = await db.centerBot.findFirst({ where: { centerId, status: "ACTIVE", center: { disabledAt: null, ownBotAllowed: true } }, select: { botId: true } });
  if (!bot) return null;
  const started = await db.botChat.findUnique({ where: { botId_chatId: { botId: bot.botId, chatId } }, select: { blockedAt: true } });
  return started && !started.blockedAt ? bot.botId : null;
}

const seen = new Map<string, number>();
const SEEN_MS = 10 * 60_000;

/** This person wrote to (or pressed something in) a center bot: it can message them. */
export async function markBotChat(botId: string, chatId: string, now = Date.now()): Promise<void> {
  const key = `${botId}:${chatId}`;
  if (now - (seen.get(key) ?? 0) < SEEN_MS) return;
  await db.botChat.upsert({ where: { botId_chatId: { botId, chatId } }, create: { botId, chatId }, update: { blockedAt: null } });
  seen.set(key, now);
  if (seen.size > 5000) seen.delete(seen.keys().next().value!);
}

/** 403 from a center bot, or the person blocked it: its messages go through the shared bot again. */
export async function markBotBlocked(botId: string, chatId: string): Promise<void> {
  seen.delete(`${botId}:${chatId}`);
  await db.botChat.updateMany({ where: { botId, chatId }, data: { blockedAt: new Date() } });
}

/** Can some center bot still reach this person? Then a 403 from the shared bot must not unlink them. */
export async function reachableByCenterBot(chatId: string): Promise<boolean> {
  return (await db.botChat.count({ where: { chatId, blockedAt: null, bot: { status: "ACTIVE" } } })) > 0;
}

/**
 * "Tell families": one message through the shared bot to every linked family chat of this center that has
 * not started the center's bot yet. Re-pressing does not send twice (dedupe per bot and chat).
 */
export async function tellFamilies(centerId: string, userId: string): Promise<number> {
  const bot = await db.centerBot.findUnique({ where: { centerId }, include: { center: { select: { name: true } } } });
  if (!bot || bot.status !== "ACTIVE") throw new UserError("ownBot.wrongState");
  const [guardians, students, started] = await Promise.all([
    db.guardian.findMany({ where: { family: { centerId }, telegramChatId: { not: null } }, select: { telegramChatId: true } }),
    db.student.findMany({ where: { centerId, status: "ACTIVE", telegramChatId: { not: null } }, select: { telegramChatId: true } }),
    db.botChat.findMany({ where: { botId: bot.botId }, select: { chatId: true } }),
  ]);
  const skip = new Set(started.map((s) => s.chatId));
  const ids = [...new Set([...guardians, ...students].map((x) => x.telegramChatId!))].filter((id) => !skip.has(id));
  if (ids.length === 0) return 0;
  const links = await db.telegramLink.findMany({ where: { chatId: { in: ids } }, select: { chatId: true, locale: true } });
  const locale = new Map(links.map((l) => [l.chatId, l.locale === "ru" ? ("ru" as const) : ("uz" as const)]));
  const chats: Chat[] = ids.map((chatId) => ({ chatId, locale: locale.get(chatId) ?? "uz" }));
  const link = `<a href="${botLink(bot)}">@${esc(bot.username)}</a>`;
  return db.$transaction(async (tx) => {
    const n = await enqueue(tx, centerId, chats, (l) => makeT(l)("ownBot.movedMessage", { center: esc(bot.center.name), bot: link }), `ownbot:${bot.botId}`);
    await audit(tx, { centerId, userId, entity: "CenterBot", entityId: bot.botId, action: "bot.tellFamilies", after: { queued: n } });
    return n;
  });
}
