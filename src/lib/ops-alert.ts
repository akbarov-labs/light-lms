// Operator alerts through the center's own Telegram bot (free): set OPS_TELEGRAM_CHAT_ID to your chat id.
// Used for server errors, failed jobs and missing backups. The same alert is sent at most once per 10 minutes
// per process, so a crash loop cannot flood the chat. Never include personal data in alert text.
import { BRAND } from "@/config/brand";
import { opsTelegramChatId, rawAppUrl, telegramBotToken } from "./env";

const THROTTLE_MS = 10 * 60_000;
const lastSent = new Map<string, number>();

export function opsAlertsEnabled(): boolean {
  return Boolean(telegramBotToken() && opsTelegramChatId());
}

/** Returns true when a message went out; false when alerts are off, throttled, or Telegram failed. */
export async function alertOps(key: string, text: string, now = Date.now()): Promise<boolean> {
  if (!opsAlertsEnabled()) return false;
  const prev = lastSent.get(key);
  if (prev !== undefined && now - prev < THROTTLE_MS) return false;
  lastSent.set(key, now);
  const where = (rawAppUrl() ?? "").replace(/^https?:\/\//, "") || "server";
  try {
    const res = await fetch(`https://api.telegram.org/bot${telegramBotToken()}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: opsTelegramChatId(), text: `[${BRAND.name} · ${where}] ${text}`.slice(0, 3900), disable_web_page_preview: true }),
      signal: AbortSignal.timeout(5_000),
    });
    return res.ok;
  } catch {
    return false;
  }
}

/** Test hook: forget throttling state. */
export function resetOpsAlerts(): void {
  lastSent.clear();
}
