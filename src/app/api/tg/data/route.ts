// Mini App data: the body is Telegram.WebApp.initData, verified with the bot token on every call — no
// cookie (Telegram Web frames the app, third-party cookies are often blocked). ?b=<bot id> = the Mini App
// of a center's own bot (managed bots): checked with that bot's token, and only that center is shown.
import { portalFor } from "@/lib/portal";
import { chatLocale } from "@/worker/bot/data";
import { withBotScope } from "@/lib/managed-bots/scope";
import { webAppCaller } from "@/lib/telegram-webapp-auth";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const caller = await webAppCaller(req, await req.text());
  if (!caller.ok) return caller.response;
  const { chatId, user } = caller;
  const locale = (await chatLocale(chatId)) ?? (user.language_code === "ru" ? "ru" : "uz");
  const data = await withBotScope(caller.scope, () => portalFor(chatId));
  return Response.json({ locale, name: user.first_name ?? "", data }, { headers: { "cache-control": "no-store" } });
}
