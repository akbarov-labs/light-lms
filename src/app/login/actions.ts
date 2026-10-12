"use server";

import { demoMode } from "@/config/brand";
import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { isLocale, LANG_COOKIE, makeT, type TFn } from "@/lib/i18n";
import { normalizePhone } from "@/lib/phone";
import { dbAttemptStore } from "@/lib/auth/attempts-db";
import { attemptKey, checkAttempts, recordAttempt, retryMinutes, RULES } from "@/lib/auth/ratelimit";
import { clientIp, passwordProblem } from "@/lib/auth/security";
import { issueSession } from "@/lib/auth/session-cookie";
import { requestResetCode, resetWithCode } from "@/lib/auth/password";

export type LoginState = { error?: string; message?: string; phone?: string; at?: number } | null;

const DUMMY_HASH = "$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv";

async function tr(): Promise<TFn> {
  const lang = (await cookies()).get(LANG_COOKIE)?.value;
  return makeT(isLocale(lang) ? lang : "uz");
}

export async function loginAction(_: LoginState, fd: FormData): Promise<LoginState> {
  const t = await tr();
  const ip = clientIp(await headers());
  const rawPhone = String(fd.get("phone") ?? "").slice(0, 32);
  const phone = normalizePhone(rawPhone);
  const password = String(fd.get("password") ?? "");

  const keys = [attemptKey.loginIp(ip), ...(phone ? [attemptKey.loginPhone(phone)] : [])];
  const verdict = await checkAttempts(dbAttemptStore, [
    { key: attemptKey.loginIp(ip), rule: RULES.loginIp },
    ...(phone ? [{ key: attemptKey.loginPhone(phone), rule: RULES.loginPhone }] : []),
  ]);
  // locked: refuse without checking the password (and without recording, so the lock does not extend itself)
  if (!verdict.allowed) return { error: t("auth.locked", { minutes: retryMinutes(verdict.retryAfterMs) }), phone: rawPhone, at: Date.now() };

  const user = phone ? await db.user.findUnique({ where: { phone }, include: { center: { select: { disabledAt: true } } } }) : null;
  // Always run bcrypt so response time does not reveal whether the phone exists.
  const ok = await bcrypt.compare(password, user?.passwordHash ?? DUMMY_HASH);
  if (!user || !ok) {
    await recordAttempt(dbAttemptStore, keys, false);
    return { error: t("auth.invalid"), phone: rawPhone, at: Date.now() };
  }
  if (user.archivedAt) return { error: t("auth.archived"), at: Date.now() };
  if (user.center.disabledAt) {
    // a switched-off center (platform admin) counts as a failed attempt, so the limiter still sees it
    await recordAttempt(dbAttemptStore, keys, false);
    return { error: t("auth.centerDisabled"), phone: rawPhone, at: Date.now() };
  }
  await recordAttempt(dbAttemptStore, keys, true);

  await issueSession({ sub: user.id, cid: user.centerId, pwc: user.mustChangePassword });
  const jar = await cookies();
  if (user.locale && isLocale(user.locale)) jar.set(LANG_COOKIE, user.locale, { path: "/", sameSite: "lax", maxAge: 31536000 });
  if (user.mustChangePassword) redirect("/password");
  const next = String(fd.get("next") ?? "");
  // only same-site paths: "/x", never "//host" or "/\host"
  const safeNext = /^\/(?![\/\\])/.test(next) && !/[\r\n\\]/.test(next) ? next : null;
  redirect(safeNext ?? (user.role === "TEACHER" ? "/t" : "/"));
}

/** Step 1 of "forgot password": send a code to the linked Telegram chat. Same answer whether or not the phone exists. */
export async function requestCodeAction(_: LoginState, fd: FormData): Promise<LoginState> {
  const t = await tr();
  if (demoMode()) return { error: t("demo.blocked"), at: Date.now() };
  const phone = normalizePhone(String(fd.get("phone") ?? ""));
  const r = await requestResetCode(phone, clientIp(await headers()));
  if (r.result === "limited") return { error: t("auth.locked", { minutes: retryMinutes(r.retryAfterMs ?? 0) }), at: Date.now() };
  if (r.result === "unavailable") return { error: t("auth.resetNoBot"), at: Date.now() };
  return { message: t("auth.codeSent"), phone: String(fd.get("phone") ?? ""), at: Date.now() };
}

/** Step 2: code + new password. */
export async function resetPasswordAction(_: LoginState, fd: FormData): Promise<LoginState> {
  const t = await tr();
  if (demoMode()) return { error: t("demo.blocked"), at: Date.now() };
  const phone = normalizePhone(String(fd.get("phone") ?? ""));
  const code = String(fd.get("code") ?? "");
  const password = String(fd.get("password") ?? "");
  if (password !== String(fd.get("password2") ?? "")) return { error: t("auth.passwordMismatch"), at: Date.now() };
  const problem = passwordProblem(password, phone ?? undefined);
  if (problem) return { error: t(problem === "short" ? "auth.passwordShort" : "auth.passwordWeak"), at: Date.now() };
  const r = await resetWithCode(phone, code, password, clientIp(await headers()));
  if (r.result === "limited") return { error: t("auth.locked", { minutes: retryMinutes(r.retryAfterMs ?? 0) }), at: Date.now() };
  if (r.result === "invalid") return { error: t("auth.codeInvalid"), at: Date.now() };
  redirect("/login?reset=1");
}
