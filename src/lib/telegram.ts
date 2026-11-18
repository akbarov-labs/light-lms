// Direct Telegram Bot API call for messages the web app must send immediately (password reset codes).
// Everything else goes through the Notification queue processed by the worker.
import { telegramBotToken } from "./env";
import { botCall, managedBotToken } from "./managed-bots/api";
import { routeBotFor } from "./managed-bots/service";

export function telegramEnabled(): boolean {
  return !!telegramBotToken();
}

/**
 * Send now. With `centerId`, a person who started that center's own bot (managed bots) gets it there; if
 * that fails, or they didn't, the shared bot sends it.
 */
export async function sendTelegram(chatId: string, text: string, centerId?: string): Promise<void> {
  const token = telegramBotToken();
  if (!token) throw new Error("TELEGRAM_BOT_TOKEN is not set");
  const params = { chat_id: chatId, text, parse_mode: "HTML" };
  const botId = centerId ? await routeBotFor(centerId, chatId).catch(() => null) : null;
  if (botId) {
    try {
      await botCall(await managedBotToken(botId), "sendMessage", params);
      return;
    } catch (e) {
      console.warn("[telegram] center bot send failed, using the shared bot", (e as { description?: string }).description ?? (e as Error).message);
    }
  }
  await botCall(token, "sendMessage", params);
}
