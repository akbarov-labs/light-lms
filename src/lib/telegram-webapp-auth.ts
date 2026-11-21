// Who is calling a Mini App API: Telegram.WebApp.initData, verified with the bot token on every call — no
// cookie (Telegram Web frames the app, third-party cookies are often blocked). ?b=<bot id> = the Mini App of a
// center's own bot (managed bots): checked with that bot's token, and only that center is shown.
import { telegramBotToken } from "@/lib/env";
import { verifyInitData, type WebAppUser } from "@/lib/telegram-webapp";
import { db } from "@/lib/db";
import { managedBotToken } from "@/lib/managed-bots/api";
import { RUNNING, managedBotsOn } from "@/lib/managed-bots/service";
import type { BotScope } from "@/lib/managed-bots/scope";

/** The token to check with and the scope to read in, or null when this bot can't open the Mini App. */
export async function webAppBot(b: string | null): Promise<{ token: string; scope: BotScope | null } | null> {
  const shared = telegramBotToken();
  if (!shared) return null;
  if (!b) return { token: shared, scope: null };
  if (!/^\d{1,20}$/.test(b) || !managedBotsOn()) return null;
  const bot = await db.centerBot.findFirst({ where: { botId: b, status: { in: RUNNING }, center: { disabledAt: null, ownBotAllowed: true } }, select: { botId: true, centerId: true } });
  if (!bot) return null;
  const token = await managedBotToken(bot.botId).catch(() => null);
  return token ? { token, scope: { centerId: bot.centerId, botId: bot.botId } } : null;
}

export type WebAppCaller = { ok: true; chatId: string; user: WebAppUser; scope: BotScope | null } | { ok: false; response: Response };

/** Check the init data of a call to `req` (?b= read from its URL). In a private chat with the bot the chat id is the user id. */
export async function webAppCaller(req: Request, initData: string): Promise<WebAppCaller> {
  const bot = await webAppBot(new URL(req.url).searchParams.get("b"));
  if (!bot) return { ok: false, response: Response.json({ error: "bot_disabled" }, { status: 503 }) };
  const check = verifyInitData(initData.slice(0, 4096), bot.token);
  if (!check.ok) return { ok: false, response: Response.json({ error: check.reason }, { status: 401 }) };
  return { ok: true, chatId: String(check.user.id), user: check.user, scope: bot.scope };
}
