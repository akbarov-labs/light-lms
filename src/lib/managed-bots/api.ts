// Bot API calls for managed bots (Bot API 9.6/10.0) over plain fetch, so the web app and the worker share
// them without a grammY instance. Errors keep grammY's shape ({ error_code, description, parameters }), so
// the queue's classifySendError reads them the same way.
//
// Tokens are never stored: getManagedBotToken returns a managed bot's token whenever the shared (manager)
// bot asks, so they live in this process's memory only — nothing to encrypt, nothing in a DB dump.
import { telegramBotToken } from "../env";

export class TelegramApiError extends Error {
  constructor(
    public error_code: number,
    public description: string,
    public parameters?: { retry_after?: number },
  ) {
    super(`telegram ${error_code}: ${description}`);
  }
}

/** Call `method` with `token`. Tests replace the transport with setBotApiTransport. */
export type BotApiTransport = (token: string, method: string, params: Record<string, unknown>) => Promise<unknown>;

const fetchTransport: BotApiTransport = async (token, method, params) => {
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => null)) as { ok?: boolean; result?: unknown; error_code?: number; description?: string; parameters?: { retry_after?: number } } | null;
  if (!body?.ok) throw new TelegramApiError(body?.error_code ?? res.status, String(body?.description ?? res.statusText).slice(0, 300), body?.parameters);
  return body.result;
};

let transport: BotApiTransport = fetchTransport;

/** Tests only: record calls instead of reaching Telegram. Pass null to restore fetch. */
export function setBotApiTransport(t: BotApiTransport | null): void {
  transport = t ?? fetchTransport;
  tokens.clear();
}

export function botCall<T>(token: string, method: string, params: Record<string, unknown> = {}): Promise<T> {
  return transport(token, method, params) as Promise<T>;
}

/** A call made by the shared bot, which manages every center bot. */
export function managerCall<T>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const token = telegramBotToken();
  if (!token) return Promise.reject(new Error("TELEGRAM_BOT_TOKEN is not set"));
  return botCall<T>(token, method, params);
}

const TOKEN_TTL_MS = 10 * 60_000;
const tokens = new Map<string, { token: string; at: number }>();

/**
 * A managed bot's token, from this process's cache (10 minutes) or getManagedBotToken. `fresh` skips the
 * cache (worker start, a token-change update, a 401).
 */
export async function managedBotToken(botId: string, opts: { fresh?: boolean; now?: number } = {}): Promise<string> {
  const now = opts.now ?? Date.now();
  const hit = tokens.get(botId);
  if (!opts.fresh && hit && now - hit.at < TOKEN_TTL_MS) return hit.token;
  const token = await managerCall<string>("getManagedBotToken", { user_id: Number(botId) });
  tokens.set(botId, { token, at: now });
  return token;
}

/** Drop a cached token (Telegram said it changed, or a call with it got 401). */
export function forgetManagedBotToken(botId: string): void {
  tokens.delete(botId);
}

/** Limit the bot to its owner (testing) or open it to everyone (launched). */
export function setManagedBotAccess(botId: string, restricted: boolean): Promise<boolean> {
  return managerCall<boolean>("setManagedBotAccessSettings", { user_id: Number(botId), is_access_restricted: restricted });
}

/**
 * Is this failure final for the bot (deleted, no longer managed by us, token revoked for good)? 400/401/403/404
 * from getManagedBotToken or the bot's own calls. Network errors, 5xx and 429 are not: try again later.
 */
export function botGone(e: unknown): boolean {
  const code = (e as { error_code?: number })?.error_code;
  return code === 400 || code === 401 || code === 403 || code === 404;
}
