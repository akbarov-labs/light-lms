// Mini App data: the body is Telegram.WebApp.initData, verified with this installation's bot token on
// every call — no cookie (Telegram Web frames the app, third-party cookies are often blocked).
import { telegramBotToken } from "@/lib/env";
import { verifyInitData } from "@/lib/telegram-webapp";
import { portalFor } from "@/lib/portal";
import { chatLocale } from "@/worker/bot/data";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const token = telegramBotToken();
  if (!token) return Response.json({ error: "bot_disabled" }, { status: 503 });
  const raw = (await req.text()).slice(0, 4096);
  const check = verifyInitData(raw, token);
  if (!check.ok) return Response.json({ error: check.reason }, { status: 401 });
  // in a private chat with the bot the chat id is the user id
  const chatId = String(check.user.id);
  const locale = (await chatLocale(chatId)) ?? (check.user.language_code === "ru" ? "ru" : "uz");
  const data = await portalFor(chatId);
  return Response.json({ locale, name: check.user.first_name ?? "", data }, { headers: { "cache-control": "no-store" } });
}
