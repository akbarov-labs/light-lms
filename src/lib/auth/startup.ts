// Startup guard shared by the web server (instrumentation.ts) and the worker.
import { checkAuthSecret, isHttpsDeployment, isLocalAppUrl, isPublicSecret } from "./secret";
import { rawAppUrl } from "@/lib/env";

export type SecretVerdict = { action: "ok" } | { action: "warn" | "refuse"; message: string };

/**
 * - any weak AUTH_SECRET on an https deployment → refuse;
 * - a missing/published secret (dev compose fallback, .env.example) when APP_URL is not
 *   localhost → refuse, even over plain http (a LAN/IP install is reachable by others);
 * - otherwise a weak secret only warns, so `docker compose up` on localhost keeps working.
 */
export function authSecretVerdict(secret: string | undefined, appUrl: string | undefined): SecretVerdict {
  const check = checkAuthSecret(secret);
  if (check.ok) return { action: "ok" };
  const message = `weak AUTH_SECRET: ${check.problems.join("; ")}`;
  if (isHttpsDeployment(appUrl)) return { action: "refuse", message };
  if (isPublicSecret(secret) && !isLocalAppUrl(appUrl)) return { action: "refuse", message: `${message} (APP_URL is not localhost)` };
  return { action: "warn", message };
}

export function assertStrongAuthSecret(who: string): void {
  const v = authSecretVerdict(process.env.AUTH_SECRET, rawAppUrl());
  if (v.action === "ok") return;
  if (v.action === "refuse") {
    const msg = `[${who}] ${v.message}. Refusing to start. Generate one with: openssl rand -base64 32`;
    console.error(msg);
    throw new Error(msg);
  }
  console.warn(`[${who}] ${v.message} (allowed only because APP_URL is a local http address)`);
}
