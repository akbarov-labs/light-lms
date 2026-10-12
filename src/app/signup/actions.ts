"use server";

import bcrypt from "bcryptjs";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { isLocale, LANG_COOKIE, makeT, type Locale } from "@/lib/i18n";
import { normalizePhone } from "@/lib/phone";
import { PERMS } from "@/lib/perms";
import { dbAttemptStore } from "@/lib/auth/attempts-db";
import { BCRYPT_ROUNDS } from "@/lib/auth/password";
import { attemptKey, checkAttempts, recordAttempt, retryMinutes, RULES } from "@/lib/auth/ratelimit";
import { clientIp, passwordProblem } from "@/lib/auth/security";
import { issueSession } from "@/lib/auth/session-cookie";
import { fromISODate, todayISO } from "@/lib/dates";
import { uzPublicHolidays } from "@/lib/holidays";
import { looksLikeBot, slugify, uniqueSlug } from "@/lib/signup-rules";

/** `values` refill the form after an error (React resets forms once an action finishes); never the password. */
export type SignupState = { error?: string; at?: number; values?: { centerName: string; ownerName: string; phone: string; locale: string } } | null;

const str = (fd: FormData, k: string) => String(fd.get(k) ?? "").trim();

/** Public "create your center": Center + main Branch + OWNER, then signs the owner in and opens the setup wizard. */
export async function signupAction(_: SignupState, fd: FormData): Promise<SignupState> {
  const jar = await cookies();
  const pick = str(fd, "locale");
  const cookieLang = jar.get(LANG_COOKIE)?.value;
  const locale: Locale = isLocale(pick) ? pick : isLocale(cookieLang) ? cookieLang : "uz";
  const t = makeT(locale);
  const now = new Date();
  const ip = clientIp(await headers());
  const values = { centerName: str(fd, "centerName").slice(0, 120), ownerName: str(fd, "ownerName").slice(0, 120), phone: str(fd, "phone").slice(0, 30), locale };
  const fail = async (error: string): Promise<SignupState> => {
    await recordAttempt(dbAttemptStore, [attemptKey.signupIp(ip)], false, now);
    return { error, at: Date.now(), values };
  };

  const verdict = await checkAttempts(
    dbAttemptStore,
    [
      { key: attemptKey.signupIp(ip), rule: RULES.signupIp },
      { key: attemptKey.signupCreatedIp(ip), rule: RULES.signupCreatedIp },
    ],
    now,
  );
  if (!verdict.allowed) return { error: t("auth.locked", { minutes: retryMinutes(verdict.retryAfterMs) }), at: Date.now(), values };
  if (looksLikeBot({ honeypot: str(fd, "website"), startedAt: str(fd, "startedAt") }, now)) return fail(t("signup.blocked"));

  const { centerName, ownerName } = values;
  const phone = normalizePhone(str(fd, "phone"));
  const password = String(fd.get("password") ?? "");
  if (!centerName || !ownerName) return fail(t("signup.required"));
  if (!phone) return fail(t("signup.phoneInvalid"));
  const problem = password.length > 200 ? "weak" : passwordProblem(password, phone);
  if (problem) return fail(t(problem === "short" ? "auth.passwordShort" : "auth.passwordWeak"));
  if (await db.user.findUnique({ where: { phone }, select: { id: true } })) return fail(t("signup.phoneTaken"));

  const passwordHash = await bcrypt.hash(password, BCRYPT_ROUNDS);
  const base = slugify(centerName);
  const year = Number(todayISO().slice(0, 4));
  const create = async (slug: string) =>
    db.$transaction(async (tx) => {
      const center = await tx.center.create({ data: { name: centerName, slug, locale, phone, plan: "FREE" } });
      await tx.branch.create({ data: { centerId: center.id, name: t("signup.defaultBranch"), phone } });
      await tx.holiday.createMany({ data: uzPublicHolidays([year, year + 1]).map((h) => ({ centerId: center.id, date: fromISODate(h.date), name: h.name })), skipDuplicates: true });
      const user = await tx.user.create({ data: { centerId: center.id, phone, name: ownerName, passwordHash, role: "OWNER", perms: [...PERMS], locale } });
      await audit(tx, { centerId: center.id, userId: user.id, entity: "Center", entityId: center.id, action: "signup", after: { name: centerName, slug, locale, plan: "FREE", owner: ownerName, ip } });
      return { centerId: center.id, userId: user.id };
    });

  let created: { centerId: string; userId: string };
  try {
    const taken = await db.center.findMany({ where: { slug: { startsWith: base } }, select: { slug: true } });
    created = await create(uniqueSlug(base, taken.map((c) => c.slug)));
  } catch (e) {
    if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002")) throw e;
    // lost a race: the phone was just registered, or another signup took the same slug
    if (await db.user.findUnique({ where: { phone }, select: { id: true } })) return fail(t("signup.phoneTaken"));
    created = await create(`${base}-${now.getTime().toString(36)}`);
  }

  // a created center spends this address's daily budget (the store counts "failures" = spent attempts)
  await recordAttempt(dbAttemptStore, [attemptKey.signupCreatedIp(ip)], false, now);
  await issueSession({ sub: created.userId, cid: created.centerId });
  jar.set(LANG_COOKIE, locale, { path: "/", sameSite: "lax", maxAge: 31536000 });
  redirect("/setup");
}
