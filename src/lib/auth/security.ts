// Small security helpers shared by login, password reset, middleware and startup checks.
import { createHmac, randomInt, timingSafeEqual } from "node:crypto";
import { isHttpsDeployment } from "./secret";
import { trustProxy } from "@/lib/env";

export { checkAuthSecret, isHttpsDeployment, isLocalAppUrl, isPublicSecret, type SecretCheck } from "./secret";

/**
 * Client IP for rate limiting. X-Forwarded-For / X-Real-IP are client-settable, so they are read
 * only when TRUST_PROXY=true (docker-compose.prod.yml: Caddy overwrites them and the app port is
 * not published, so the last XFF entry is the real peer). Otherwise the direct peer address is
 * used when the caller has one, else every request shares one "direct" bucket (fail closed:
 * spoofed headers can't mint fresh rate-limit buckets).
 */
export function clientIp(h: { get(name: string): string | null }, opts: { peer?: string | null; trustProxy?: boolean } = {}): string {
  const trust = opts.trustProxy ?? trustProxy();
  if (trust) {
    const xff = h.get("x-forwarded-for");
    if (xff) {
      const parts = xff.split(",").map((p) => p.trim()).filter(Boolean);
      if (parts.length) return parts[parts.length - 1].slice(0, 64);
    }
    const real = (h.get("x-real-ip") ?? "").trim().slice(0, 64);
    if (real) return real;
  }
  const peer = (opts.peer ?? "").trim().slice(0, 64);
  return peer || "direct";
}

/** Cookies get `Secure` when the site is served over HTTPS (directly or behind the proxy). */
export function secureCookies(h?: { get(name: string): string | null }): boolean {
  return isHttpsDeployment() || h?.get("x-forwarded-proto") === "https";
}

// ---------------------------------------------------------------- one-time codes

export const RESET_CODE_TTL_MS = 10 * 60_000;
export const RESET_CODE_MAX_TRIES = 5;

export function newResetCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

/** Codes are stored only as an HMAC (keyed with AUTH_SECRET), bound to the user. */
export function hashResetCode(userId: string, code: string, secret: string = process.env.AUTH_SECRET ?? ""): string {
  return createHmac("sha256", secret).update(`${userId}:${code}`).digest("hex");
}

export function resetCodeMatches(userId: string, code: string, hash: string, secret?: string): boolean {
  const a = Buffer.from(hashResetCode(userId, code.trim(), secret), "hex");
  const b = Buffer.from(hash, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Temporary password an admin reads out to a staff member: no look-alike characters. */
export function newTempPassword(length = 10): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  for (let i = 0; i < length; i++) out += alphabet[randomInt(0, alphabet.length)];
  return out;
}

export const MIN_PASSWORD = 8;

/** New passwords (self-chosen): at least 8 characters, not all digits of one kind, not the phone. */
export function passwordProblem(pw: string, phone?: string): "short" | "weak" | null {
  if (pw.length < MIN_PASSWORD) return "short";
  if (new Set(pw).size < 4) return "weak";
  if (phone && pw.replace(/\D/g, "").length >= 7 && phone.endsWith(pw.replace(/\D/g, ""))) return "weak";
  if (/^(12345678|password|parol|qwerty)/i.test(pw)) return "weak";
  return null;
}
