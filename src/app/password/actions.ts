"use server";

import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { getCtx } from "@/lib/ctx";
import { db } from "@/lib/db";
import { makeT } from "@/lib/i18n";
import { dbAttemptStore } from "@/lib/auth/attempts-db";
import { attemptKey, checkAttempts, recordAttempt, retryMinutes, RULES } from "@/lib/auth/ratelimit";
import { passwordProblem } from "@/lib/auth/security";
import { changeOwnPassword } from "@/lib/auth/password";
import { issueSession } from "@/lib/auth/session-cookie";

export type PasswordState = { error?: string; at?: number } | null;

export async function changePasswordAction(_: PasswordState, fd: FormData): Promise<PasswordState> {
  const ctx = await getCtx();
  if (!ctx) redirect("/login");
  const t = ctx.t ?? makeT("uz");
  const user = await db.user.findUniqueOrThrow({ where: { id: ctx.userId } });
  const password = String(fd.get("password") ?? "");
  const fail = (key: Parameters<typeof t>[0], vars?: Record<string, string | number>) => ({ error: t(key, vars), at: Date.now() });

  // After an admin reset the fresh session is proof enough; otherwise the current password is required.
  if (!user.mustChangePassword) {
    const key = attemptKey.loginPhone(user.phone);
    const verdict = await checkAttempts(dbAttemptStore, [{ key, rule: RULES.loginPhone }]);
    if (!verdict.allowed) return fail("auth.locked", { minutes: retryMinutes(verdict.retryAfterMs) });
    if (!(await bcrypt.compare(String(fd.get("current") ?? ""), user.passwordHash))) {
      await recordAttempt(dbAttemptStore, [key], false);
      return fail("auth.currentWrong");
    }
  }
  if (password !== String(fd.get("password2") ?? "")) return fail("auth.passwordMismatch");
  const problem = passwordProblem(password, user.phone);
  if (problem) return fail(problem === "short" ? "auth.passwordShort" : "auth.passwordWeak");
  if (await bcrypt.compare(password, user.passwordHash)) return fail("auth.passwordSame");

  await changeOwnPassword(user, password);
  // older sessions (other devices) are now invalid; this one gets a fresh token
  await issueSession({ sub: user.id, cid: user.centerId });
  redirect(user.role === "TEACHER" ? "/t" : "/");
}
