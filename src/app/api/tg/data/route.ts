// Mini App data: the body is Telegram.WebApp.initData, verified with the bot token on every call — no
// cookie (Telegram Web frames the app, third-party cookies are often blocked). ?b=<bot id> = the Mini App
// of a center's own bot (managed bots): checked with that bot's token, and only that center is shown.
import { telegramBotToken } from "@/lib/env";
import { verifyInitData } from "@/lib/telegram-webapp";
import { portalFor } from "@/lib/portal";
import { chatLocale } from "@/worker/bot/data";
import { db } from "@/lib/db";
import { managedBotToken } from "@/lib/managed-bots/api";
import { RUNNING, managedBotsOn } from "@/lib/managed-bots/service";
import { withBotScope, type BotScope } from "@/lib/managed-bots/scope";

export const dynamic = "force-dynamic";

/** The token to check with and the scope to read in, or null when this bot can't open the Mini App. */
async function botFor(b: string | null): Promise<{ token: string; scope: BotScope | null } | null> {
  const shared = telegramBotToken();
  if (!shared) return null;
  if (!b) return { token: shared, scope: null };
  if (!/^\d{1,20}$/.test(b) || !managedBotsOn()) return null;
  const bot = await db.centerBot.findFirst({ where: { botId: b, status: { in: RUNNING }, center: { disabledAt: null, ownBotAllowed: true } }, select: { botId: true, centerId: true } });
  if (!bot) return null;
  const token = await managedBotToken(bot.botId).catch(() => null);
  return token ? { token, scope: { centerId: bot.centerId, botId: bot.botId } } : null;
}

export async function POST(req: Request) {
  const bot = await botFor(new URL(req.url).searchParams.get("b"));
  if (!bot) return Response.json({ error: "bot_disabled" }, { status: 503 });
  const raw = (await req.text()).slice(0, 4096);
  const check = verifyInitData(raw, bot.token);
  if (!check.ok) return Response.json({ error: check.reason }, { status: 401 });
  // in a private chat with the bot the chat id is the user id
  const chatId = String(check.user.id);
  const locale = (await chatLocale(chatId)) ?? (check.user.language_code === "ru" ? "ru" : "uz");
  const data = await withBotScope(bot.scope, () => portalFor(chatId));
  return Response.json({ locale, name: check.user.first_name ?? "", data }, { headers: { "cache-control": "no-store" } });
}
