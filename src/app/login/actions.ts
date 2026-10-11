"use server";

import bcrypt from "bcryptjs";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "@/lib/db";
import { isLocale, LANG_COOKIE, makeT } from "@/lib/i18n";
import { normalizePhone } from "@/lib/phone";
import { SESSION_COOKIE, SESSION_DAYS, signSession } from "@/lib/session";

export type LoginState = { error?: string } | null;

export async function loginAction(_: LoginState, fd: FormData): Promise<LoginState> {
  const jar = await cookies();
  const lang = jar.get(LANG_COOKIE)?.value;
  const t = makeT(isLocale(lang) ? lang : "uz");
  const phone = normalizePhone(String(fd.get("phone") ?? ""));
  const password = String(fd.get("password") ?? "");
  const user = phone ? await db.user.findUnique({ where: { phone } }) : null;
  // Always run bcrypt so response time does not reveal whether the phone exists.
  const ok = await bcrypt.compare(password, user?.passwordHash ?? "$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv");
  if (!user || !ok) return { error: t("auth.invalid") };
  if (user.archivedAt) return { error: t("auth.archived") };

  const token = await signSession({ sub: user.id, cid: user.centerId });
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: (process.env.APP_URL ?? "").startsWith("https://"),
    path: "/",
    maxAge: SESSION_DAYS * 86400,
  });
  if (user.locale && isLocale(user.locale)) jar.set(LANG_COOKIE, user.locale, { path: "/", sameSite: "lax", maxAge: 31536000 });
  const next = String(fd.get("next") ?? "");
  const safeNext = next.startsWith("/") && !next.startsWith("//") ? next : null;
  redirect(safeNext ?? (user.role === "TEACHER" ? "/t" : "/"));
}
