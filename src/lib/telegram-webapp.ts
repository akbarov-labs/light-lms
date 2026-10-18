// Telegram Mini App init data (core.telegram.org/bots/webapps, "Validating data received via the Mini App"):
// data-check-string = every received field except `hash`, sorted by key, "key=value" joined by "\n";
// secret = HMAC-SHA256(key "WebAppData", bot token); valid when hex HMAC-SHA256(secret, check string) = hash.
import { createHmac, timingSafeEqual } from "node:crypto";

/** Init data older than this is refused (Telegram re-signs it every time the Mini App opens). */
export const INIT_DATA_MAX_AGE_S = 24 * 60 * 60;

export interface WebAppUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
}

export type InitDataCheck = { ok: true; user: WebAppUser; authDate: number } | { ok: false; reason: "missing" | "hash" | "expired" | "user" };

export function initDataHash(fields: [string, string][], botToken: string): string {
  const check = fields
    .filter(([k]) => k !== "hash")
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join("\n");
  const secret = createHmac("sha256", "WebAppData").update(botToken).digest();
  return createHmac("sha256", secret).update(check).digest("hex");
}

export function verifyInitData(raw: string | null | undefined, botToken: string, nowS: number = Math.floor(Date.now() / 1000)): InitDataCheck {
  if (!raw || raw.length > 4096) return { ok: false, reason: "missing" };
  const params = new URLSearchParams(raw);
  const hash = params.get("hash");
  if (!hash || !/^[0-9a-f]{64}$/.test(hash)) return { ok: false, reason: "missing" };
  const expected = initDataHash([...params.entries()], botToken);
  if (!timingSafeEqual(Buffer.from(expected), Buffer.from(hash))) return { ok: false, reason: "hash" };
  const authDate = Number(params.get("auth_date"));
  if (!Number.isFinite(authDate) || nowS - authDate > INIT_DATA_MAX_AGE_S || authDate - nowS > 300) return { ok: false, reason: "expired" };
  try {
    const user = JSON.parse(params.get("user") ?? "") as WebAppUser;
    if (!Number.isSafeInteger(user?.id) || user.id <= 0) return { ok: false, reason: "user" };
    return { ok: true, user, authDate };
  } catch {
    return { ok: false, reason: "user" };
  }
}
