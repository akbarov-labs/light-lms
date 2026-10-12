// Password changes, admin resets and Telegram reset codes. Every path ends in setPassword(),
// which also invalidates older sessions (passwordChangedAt) and unused reset codes.
import bcrypt from "bcryptjs";
import { db, type Tx } from "../db";
import { audit } from "../audit";
import { isLocale, makeT } from "../i18n";
import { dbAttemptStore } from "./attempts-db";
import { attemptKey, checkAttempts, recordAttempt, RULES } from "./ratelimit";
import { hashResetCode, newResetCode, newTempPassword, RESET_CODE_MAX_TRIES, RESET_CODE_TTL_MS, resetCodeMatches } from "./security";
import { sendTelegram, telegramEnabled } from "../telegram";

export const BCRYPT_ROUNDS = 10;

export async function setPassword(tx: Tx, user: { id: string; phone: string }, password: string, opts: { mustChange: boolean }): Promise<void> {
  const now = new Date();
  await tx.user.update({
    where: { id: user.id },
    data: { passwordHash: await bcrypt.hash(password, BCRYPT_ROUNDS), passwordChangedAt: now, mustChangePassword: opts.mustChange },
  });
  await tx.passwordReset.updateMany({ where: { userId: user.id, usedAt: null }, data: { usedAt: now } });
  // a fresh password lifts a lockout on this phone
  await tx.loginAttempt.deleteMany({ where: { key: attemptKey.loginPhone(user.phone) } });
}

/** Admin reset: new temporary password, the user must replace it after signing in. Returns it once. */
export async function adminResetPassword(actor: { userId: string; centerId: string }, target: { id: string; phone: string }): Promise<string> {
  const temp = newTempPassword();
  await db.$transaction(async (tx) => {
    await setPassword(tx, target, temp, { mustChange: true });
    await audit(tx, { centerId: actor.centerId, userId: actor.userId, entity: "User", entityId: target.id, action: "password.reset", after: { by: "admin" } });
  });
  return temp;
}

export type ResetRequestResult = "sent" | "limited" | "unavailable";

/**
 * Self-service: send a 6-digit code to the staff member's linked Telegram chat.
 * The caller shows the same text for unknown phones and for sent codes (no account probing).
 */
export async function requestResetCode(phone: string | null, ip: string): Promise<{ result: ResetRequestResult; retryAfterMs?: number }> {
  if (!telegramEnabled()) return { result: "unavailable" };
  const checks = [{ key: attemptKey.resetRequestIp(ip), rule: RULES.resetRequestIp }];
  if (phone) checks.push({ key: attemptKey.resetRequestPhone(phone), rule: RULES.resetRequestPhone });
  const verdict = await checkAttempts(dbAttemptStore, checks);
  if (!verdict.allowed) return { result: "limited", retryAfterMs: verdict.retryAfterMs };
  // every request counts against the budget ("failure" = not a successful login)
  await recordAttempt(dbAttemptStore, checks.map((c) => c.key), false);

  const user = phone ? await db.user.findUnique({ where: { phone }, include: { center: { select: { locale: true } } } }) : null;
  if (!user || user.archivedAt || !user.telegramChatId) return { result: "sent" };
  const code = newResetCode();
  await db.passwordReset.create({ data: { userId: user.id, codeHash: hashResetCode(user.id, code), expiresAt: new Date(Date.now() + RESET_CODE_TTL_MS) } });
  const locale = isLocale(user.locale) ? user.locale : isLocale(user.center.locale) ? user.center.locale : "uz";
  try {
    await sendTelegram(user.telegramChatId, makeT(locale)("auth.codeMessage", { code }));
  } catch (e) {
    console.error("[reset] telegram send failed", (e as Error).message);
  }
  return { result: "sent" };
}

/** Code for a staff member who asked the bot directly (/parol). Null = not a linked, active staff chat. */
export async function createResetCodeForChat(chatId: string): Promise<{ code: string; phone: string } | null> {
  const user = await db.user.findFirst({ where: { telegramChatId: chatId, archivedAt: null } });
  if (!user) return null;
  const recent = await db.passwordReset.count({ where: { userId: user.id, createdAt: { gt: new Date(Date.now() - RULES.resetRequestPhone.windowMs) } } });
  if (recent >= RULES.resetRequestPhone.limit) return null;
  const code = newResetCode();
  await db.passwordReset.create({ data: { userId: user.id, codeHash: hashResetCode(user.id, code), expiresAt: new Date(Date.now() + RESET_CODE_TTL_MS) } });
  return { code, phone: user.phone };
}

export type ResetVerifyResult = "ok" | "invalid" | "limited";

/** Check the code and set the new password. Each wrong code burns one of RESET_CODE_MAX_TRIES. */
export async function resetWithCode(phone: string | null, code: string, password: string, ip: string): Promise<{ result: ResetVerifyResult; retryAfterMs?: number }> {
  const ipKey = attemptKey.resetVerifyIp(ip);
  const verdict = await checkAttempts(dbAttemptStore, [{ key: ipKey, rule: RULES.resetVerifyIp }]);
  if (!verdict.allowed) return { result: "limited", retryAfterMs: verdict.retryAfterMs };
  const user = phone ? await db.user.findUnique({ where: { phone } }) : null;
  const reset = user && !user.archivedAt
    ? await db.passwordReset.findFirst({ where: { userId: user.id, usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } })
    : null;
  if (!user || !reset || reset.attempts >= RESET_CODE_MAX_TRIES || !/^\d{6}$/.test(code.trim()) || !resetCodeMatches(user.id, code, reset.codeHash)) {
    if (reset) await db.passwordReset.update({ where: { id: reset.id }, data: { attempts: { increment: 1 } } });
    await recordAttempt(dbAttemptStore, [ipKey], false);
    return { result: "invalid" };
  }
  await db.$transaction(async (tx) => {
    // claim the code atomically so a double submit cannot use it twice
    const claimed = await tx.passwordReset.updateMany({ where: { id: reset.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count !== 1) throw new Error("reset code already used");
    await setPassword(tx, user, password, { mustChange: false });
    await audit(tx, { centerId: user.centerId, userId: user.id, entity: "User", entityId: user.id, action: "password.reset", after: { by: "telegram-code" } });
  });
  return { result: "ok" };
}

/** Signed-in user changes their own password (also the forced change after an admin reset). */
export async function changeOwnPassword(user: { id: string; phone: string; centerId: string }, password: string): Promise<void> {
  await db.$transaction(async (tx) => {
    await setPassword(tx, user, password, { mustChange: false });
    await audit(tx, { centerId: user.centerId, userId: user.id, entity: "User", entityId: user.id, action: "password.change" });
  });
}
