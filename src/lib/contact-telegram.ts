// Where the site's "write to us" links go. With Sabaq's own AI assistant on (SALES_AGENT=true) that is our
// bot, so new customers talk to the assistant instead of a person; otherwise BRAND.contact.telegram.
// The bot's @username is asked from Telegram (getMe) once and kept for a day.
import { BRAND } from "@/config/brand";
import { salesAgentEnabled, telegramBotToken } from "@/lib/env";

const DAY = 86_400_000;
let cache: { at: number; name: string | null } | null = null;

async function botUsername(): Promise<string | null> {
  const token = telegramBotToken();
  if (!token) return null;
  if (cache && Date.now() - cache.at < DAY) return cache.name;
  try {
    const r = await fetch(`https://api.telegram.org/bot${token}/getMe`, { cache: "no-store", signal: AbortSignal.timeout(3000) });
    const j = (await r.json()) as { ok?: boolean; result?: { username?: string } };
    cache = { at: Date.now(), name: j.ok && j.result?.username ? j.result.username : null };
  } catch (e) {
    console.warn("[contact] getMe failed", e instanceof Error ? e.message : e);
    // try again in five minutes, not on every page view
    cache = { at: Date.now() - DAY + 5 * 60_000, name: null };
  }
  return cache.name;
}

/** Telegram username (without @) for contact links, or "" when there is none. */
export async function contactTelegram(): Promise<string> {
  if (salesAgentEnabled()) {
    const bot = await botUsername();
    if (bot) return bot;
  }
  return BRAND.contact.telegram;
}
