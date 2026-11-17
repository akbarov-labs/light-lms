// One place for environment variables (.env.example documents each). Read lazily on every call,
// so tests and scripts that change process.env see the new value. Edge-safe: no Node imports.

const str = (v: string | undefined): string | undefined => {
  const t = v?.trim();
  return t ? t : undefined;
};

/** Public URL of the web app without a trailing slash (links in Telegram, receipts, Payme returns). */
export function appUrl(): string {
  return (str(process.env.APP_URL) ?? "http://localhost:3000").replace(/\/+$/, "");
}

/** The raw APP_URL (undefined when unset) — for checks that must know it was not configured. */
export function rawAppUrl(): string | undefined {
  return str(process.env.APP_URL);
}

export function telegramBotToken(): string | undefined {
  return str(process.env.TELEGRAM_BOT_TOKEN);
}

/** Bot API 10.1 rich messages (sendRichMessage) for report cards, payment/debt notices and the attendance
 * summary. Off unless "true"; a refused rich send falls back to the plain HTML text. */
export function telegramRichMessages(): boolean {
  return process.env.TELEGRAM_RICH_MESSAGES === "true";
}

export function opsTelegramChatId(): string | undefined {
  return str(process.env.OPS_TELEGRAM_CHAT_ID);
}

/** Trust X-Forwarded-For only behind our own proxy (Caddy in docker-compose.prod.yml). */
export function trustProxy(): boolean {
  return process.env.TRUST_PROXY === "true";
}

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "true";
}

export function demoUrl(): string | undefined {
  return str(process.env.DEMO_URL);
}

/** Main product site when this server is the public demo; no trailing slash. */
export function mainSiteUrl(): string | undefined {
  return str(process.env.MAIN_SITE_URL)?.replace(/\/+$/, "");
}
