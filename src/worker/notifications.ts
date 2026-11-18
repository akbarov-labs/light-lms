// Sends queued Notification rows (HANDOFF §9): ≤25 messages/second, retries with backoff, auditable status.
//
// Claim: a batch is moved PENDING → SENDING in one statement (FOR UPDATE SKIP LOCKED), so two workers or a
// manual `npm run job:notifications` never pick the same row. A row left in SENDING by a crashed worker is
// taken back after STALE_LOCK_MIN minutes — the only case where a message can go out twice (sent, then the
// process died before marking it SENT). That is accepted: losing the message would be worse.
import { Api } from "grammy";
import type { NotificationChannel } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { telegramRichMessages } from "@/lib/env";
import { SmsError } from "@/lib/sms/eskiz";
import { stripTgTime } from "@/lib/messages";
import { sleep } from "./util";
import { managedBotToken } from "@/lib/managed-bots/api";
import { markBotBlocked, reachableByCenterBot, routeBotFor } from "@/lib/managed-bots/service";

/**
 * Deliver one queued row; `chatId` is the Telegram chat, or the phone for an SMS row. `meta.rich` is the
 * row's optional rich-message HTML (Telegram only; SMS senders ignore it). Returns the center bot's id when
 * a center's own bot delivered it (routedSender), nothing otherwise.
 */
export type Sender = (chatId: string, text: string, meta: { centerId: string; rich?: string | null }) => Promise<string | void>;

/** A failure the sender already classified (e.g. "don't unlink: a center bot still reaches this person"). */
export class DeliveryError extends Error {
  constructor(
    public kind: "permanent" | "transient",
    message: string,
  ) {
    super(message);
  }
}

/** One Telegram call may take this long; then it is aborted and retried later (transient), so a hung
 * connection cannot hold the whole batch — and its SENDING rows — until the 10-minute reclaim. */
export const SEND_TIMEOUT_MS = 15_000;

/**
 * May a refused rich send be replaced by the plain text right away? Only when Telegram clearly said no to
 * the rich form itself: 400 (bad rich HTML, unknown method on an older server) other than "chat not found",
 * or 404 (method missing). A timeout, network error or 5xx may still have delivered it — those are retried
 * later like any send (no duplicate); 429 and 403 keep their queue meaning (wait / unlink).
 */
export function richRefused(e: unknown): boolean {
  const err = (e ?? {}) as { error_code?: number; description?: string };
  if (err.error_code === 404) return true;
  return err.error_code === 400 && !/chat not found/i.test(err.description ?? "");
}

/**
 * The queue's sender over a grammY Api: HTML, no link previews, aborted after `timeoutMs`. With
 * `rich` on (TELEGRAM_RICH_MESSAGES) a row that has a rich form goes out with sendRichMessage, and the
 * plain text is sent instead if Telegram refuses that form (richRefused).
 */
export function telegramSender(
  api: Pick<Api, "sendMessage" | "sendRichMessage">,
  timeoutMs = SEND_TIMEOUT_MS,
  opts: { rich?: boolean; log?: (m: string) => void } = {},
): Sender {
  const useRich = opts.rich ?? telegramRichMessages();
  const log = opts.log ?? ((m: string) => console.warn(m));
  return async (chatId, text, meta) => {
    // grammY types its signal with the abort-controller shim; it only listens for "abort", so the native one works
    const signal = () => AbortSignal.timeout(timeoutMs) as unknown as Parameters<Api["sendMessage"]>[3];
    if (useRich && meta?.rich) {
      try {
        await api.sendRichMessage(chatId, { html: meta.rich }, {}, signal());
        return;
      } catch (e) {
        if (!richRefused(e)) throw e;
        log(`[notifications] rich message refused, sending plain text: ${errorText(e)}`);
      }
    }
    const opts = { parse_mode: "HTML" as const, link_preview_options: { is_disabled: true } };
    try {
      await api.sendMessage(chatId, text, opts, signal());
    } catch (e) {
      // date_time entities (<tg-time>, TELEGRAM_DATE_TIME) refused: the same message without them
      if (!text.includes("<tg-time") || !richRefused(e)) throw e;
      log(`[notifications] date_time entity refused, sending without it: ${errorText(e)}`);
      await api.sendMessage(chatId, stripTgTime(text), opts, signal());
    }
  };
}

/** How routedSender finds and reaches center bots; tests pass their own. */
export interface BotRouter {
  /** the center bot to use for this row, or null for the shared bot */
  route(centerId: string, chatId: string): Promise<string | null>;
  sender(botId: string): Promise<Sender>;
  blocked(botId: string, chatId: string): Promise<void>;
  /** does an ACTIVE center bot still reach this person? */
  reachable(chatId: string): Promise<boolean>;
}

const apis = new Map<string, { token: string; send: Sender }>();
export const defaultRouter: BotRouter = {
  route: routeBotFor,
  async sender(botId) {
    const token = await managedBotToken(botId);
    const hit = apis.get(botId);
    if (hit?.token === token) return hit.send;
    const send = telegramSender(new Api(token));
    apis.set(botId, { token, send });
    return send;
  },
  blocked: markBotBlocked,
  reachable: reachableByCenterBot,
};

/**
 * Managed bots: a row goes through the center's own bot when the person started it (routeBotFor), else
 * through the shared bot. 403 / chat not found from the center bot marks it blocked and the shared bot
 * tries in the same attempt. A 403 from the shared bot unlinks the chat only when no center bot reaches the
 * person any more: someone who only ever opened a center's bot hasn't blocked us.
 */
export function routedSender(shared: Sender, router: BotRouter = defaultRouter, log: (m: string) => void = (m) => console.warn(m)): Sender {
  return async (chatId, text, meta) => {
    const botId = await router.route(meta.centerId, chatId).catch((e) => {
      log(`[notifications] center bot lookup failed, using the shared bot: ${errorText(e)}`);
      return null;
    });
    if (botId) {
      const send = await router.sender(botId).catch((e) => {
        log(`[notifications] center bot ${botId} token not available, using the shared bot: ${errorText(e)}`);
        return null;
      });
      if (send) {
        try {
          await send(chatId, text, meta);
          return botId;
        } catch (e) {
          if (classifySendError(e).kind !== "gone") throw e;
          await router.blocked(botId, chatId);
          log(`[notifications] center bot ${botId} can't reach the chat (${errorText(e)}), using the shared bot`);
        }
      }
    }
    try {
      await shared(chatId, text, meta);
    } catch (e) {
      if (classifySendError(e).kind === "gone" && (await router.reachable(chatId))) {
        throw new DeliveryError("permanent", `shared bot: ${errorText(e)} (the person uses a center's own bot; chat kept)`);
      }
      throw e;
    }
  };
}

export const MAX_ATTEMPTS = 5;
export const STALE_LOCK_MIN = 10;
const GAP_MS: Record<NotificationChannel, number> = { TELEGRAM: 40, SMS: 200 }; // Telegram 25 msg/s, SMS 5/s
const BACKOFF_BASE_MS = 30_000;
const BACKOFF_MAX_MS = 3_600_000;

/** Delay before the next try after `attempts` failed tries: 30 s, 1 min, 2 min, … capped at 1 h. */
export function backoffMs(attempts: number): number {
  return Math.min(BACKOFF_BASE_MS * 2 ** Math.max(0, attempts - 1), BACKOFF_MAX_MS);
}

export type SendFailure =
  | { kind: "rate"; retryAfterS: number } // 429: wait, does not count as an attempt
  | { kind: "gone" } // 403 blocked/kicked, 400 chat not found: unlink the chat
  | { kind: "permanent" } // other 400 (bad markup, too long): retrying will not help
  | { kind: "transient" }; // network, 5xx: retry with backoff

/** Classify a grammY error ({ error_code, description, parameters: { retry_after } }) or any other throw. */
export function classifySendError(e: unknown): SendFailure {
  if (e instanceof SmsError || e instanceof DeliveryError) return { kind: e.kind };
  const err = (e ?? {}) as { error_code?: number; description?: string; parameters?: { retry_after?: number } };
  if (err.error_code === 429) return { kind: "rate", retryAfterS: Math.max(1, Number(err.parameters?.retry_after) || 5) };
  if (err.error_code === 403) return { kind: "gone" };
  if (err.error_code === 400) return /chat not found/i.test(err.description ?? "") ? { kind: "gone" } : { kind: "permanent" };
  return { kind: "transient" };
}

function errorText(e: unknown): string {
  const err = e as { description?: string; message?: string };
  return String(err?.description ?? err?.message ?? e).slice(0, 500);
}

interface Claimed {
  id: string;
  centerId: string;
  chatId: string;
  text: string;
  richText: string | null;
  attempts: number;
  createdAt: Date;
}

/** Take back rows a crashed sender left in SENDING. */
export async function reclaimStale(minutes = STALE_LOCK_MIN): Promise<number> {
  return db.$executeRaw`
    UPDATE "Notification" SET status = 'PENDING', "lockedAt" = NULL
    WHERE status = 'SENDING' AND "lockedAt" < ${new Date(Date.now() - minutes * 60_000)}`;
}

// Times are compared on this process's clock, the same clock Prisma uses for the @default(now()) of
// nextAttemptAt when a row is queued (a database clock a few ms behind would skip fresh rows).
async function claim(limit: number, channel: NotificationChannel): Promise<Claimed[]> {
  const now = new Date();
  const rows = await db.$queryRaw<Claimed[]>`
    UPDATE "Notification" SET status = 'SENDING', "lockedAt" = ${now}
    WHERE id IN (
      SELECT id FROM "Notification"
      WHERE status = 'PENDING' AND channel = ${channel}::"NotificationChannel" AND "nextAttemptAt" <= ${now}
      ORDER BY "createdAt"
      LIMIT ${limit}
      FOR UPDATE SKIP LOCKED
    )
    RETURNING id, "centerId", "chatId", text, "richText", attempts, "createdAt"`;
  return rows.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id));
}

/** Give claimed-but-untried rows back to the queue (rate limit hit, or shutting down). */
async function release(ids: string[], nextAttemptAt?: Date): Promise<void> {
  if (ids.length === 0) return;
  await db.notification.updateMany({
    where: { id: { in: ids }, status: "SENDING" },
    data: { status: "PENDING", lockedAt: null, ...(nextAttemptAt ? { nextAttemptAt } : {}) },
  });
}

/** Bot blocked / chat gone: fail the row and forget the chat everywhere, in one transaction. */
async function unlinkChat(n: Claimed, error: string): Promise<void> {
  await db.$transaction(async (tx) => {
    await tx.notification.update({ where: { id: n.id }, data: { status: "FAILED", attempts: n.attempts + 1, error, lockedAt: null } });
    // nothing else queued for this chat can be delivered either
    await tx.notification.updateMany({ where: { chatId: n.chatId, channel: "TELEGRAM", status: "PENDING" }, data: { status: "FAILED", error: `chat unlinked: ${error}`.slice(0, 500) } });
    await tx.telegramLink.deleteMany({ where: { chatId: n.chatId } });
    await tx.user.updateMany({ where: { telegramChatId: n.chatId }, data: { telegramChatId: null } });
    await tx.guardian.updateMany({ where: { telegramChatId: n.chatId }, data: { telegramChatId: null } });
    await tx.student.updateMany({ where: { telegramChatId: n.chatId }, data: { telegramChatId: null } });
  });
}

export interface NotificationRun {
  sent: number;
  failed: number;
  retried: number;
  unlinked: number;
  reclaimed: number;
  /** set when Telegram said 429: the batch stopped, nothing is tried before this many ms */
  rateLimitedMs?: number;
}

export async function processNotifications(
  send: Sender,
  opts: { limit?: number; signal?: AbortSignal; gapMs?: number; channel?: NotificationChannel } = {},
): Promise<NotificationRun> {
  const { limit = 100, signal, channel = "TELEGRAM" } = opts;
  const gapMs = opts.gapMs ?? GAP_MS[channel];
  const res: NotificationRun = { sent: 0, failed: 0, retried: 0, unlinked: 0, reclaimed: 0 };
  res.reclaimed = await reclaimStale();
  const batch = await claim(limit, channel);
  const gone = new Set<string>();
  for (let i = 0; i < batch.length; i++) {
    const n = batch[i];
    if (signal?.aborted) {
      await release(batch.slice(i).map((x) => x.id));
      break;
    }
    if (gone.has(n.chatId)) {
      // the chat was unlinked earlier in this batch
      await db.notification.update({ where: { id: n.id }, data: { status: "FAILED", error: "chat unlinked", lockedAt: null } });
      res.failed++;
      continue;
    }
    try {
      const via = await send(n.chatId, n.text, { centerId: n.centerId, rich: n.richText });
      await db.notification.update({
        where: { id: n.id },
        data: { status: "SENT", sentAt: new Date(), attempts: n.attempts + 1, error: null, lockedAt: null, sentVia: typeof via === "string" ? via : null },
      });
      res.sent++;
    } catch (e) {
      const why = classifySendError(e);
      const error = errorText(e);
      if (why.kind === "rate") {
        // Telegram asks us to slow down: not the message's fault, so no attempt is counted; the rest of the
        // batch waits too
        const at = new Date(Date.now() + why.retryAfterS * 1000);
        await db.notification.update({ where: { id: n.id }, data: { status: "PENDING", lockedAt: null, nextAttemptAt: at, error } });
        await release(batch.slice(i + 1).map((x) => x.id), at);
        res.rateLimitedMs = why.retryAfterS * 1000;
        break;
      }
      if (why.kind === "gone" && channel === "TELEGRAM") {
        await unlinkChat(n, error);
        gone.add(n.chatId);
        res.failed++;
        res.unlinked++;
      } else {
        const attempts = n.attempts + 1;
        const final = why.kind === "permanent" || attempts >= MAX_ATTEMPTS;
        await db.notification.update({
          where: { id: n.id },
          data: { attempts, error, lockedAt: null, status: final ? "FAILED" : "PENDING", ...(final ? {} : { nextAttemptAt: new Date(Date.now() + backoffMs(attempts)) }) },
        });
        if (final) res.failed++;
        else res.retried++;
      }
    }
    if (gapMs > 0 && i < batch.length - 1) await sleep(gapMs);
  }
  return res;
}

/** Retention: delivered messages are kept 90 days, failed ones 180 days (for "why didn't I get it?"). */
export async function purgeOldNotifications(now = new Date()): Promise<{ sent: number; failed: number }> {
  const day = 86_400_000;
  const [sent, failed] = await Promise.all([
    db.notification.deleteMany({ where: { status: "SENT", createdAt: { lt: new Date(now.getTime() - 90 * day) } } }),
    db.notification.deleteMany({ where: { status: "FAILED", createdAt: { lt: new Date(now.getTime() - 180 * day) } } }),
  ]);
  return { sent: sent.count, failed: failed.count };
}
