// Request context: the signed-in user from the session cookie, the branch switcher and language.
// Every page and server action starts with requireCtx(perm?) — HANDOFF §16.
import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "./db";
import type { Perm } from "./perms";
import { SESSION_COOKIE, sessionStale, verifySession } from "./session";
import { isLocale, LANG_COOKIE, type Locale } from "./i18n";
import { buildCtx, loadUser, UserError, type Ctx } from "./ctx-core";

export * from "./ctx-core";

export const BRANCH_COOKIE = "branch";

/** Session → context. `disabled` = a valid session whose center a platform admin switched off. */
const loadCtx = cache(async (): Promise<{ ctx: Ctx | null; disabled: boolean }> => {
  const jar = await cookies();
  const session = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!session) return { ctx: null, disabled: false };
  const user = await loadUser(session.sub);
  if (!user || user.archivedAt || user.centerId !== session.cid) return { ctx: null, disabled: false };
  if (sessionStale(session.iat, user.passwordChangedAt)) return { ctx: null, disabled: false };
  if (user.center.disabledAt) return { ctx: null, disabled: true };
  const base = buildCtx(user);
  const picked = jar.get(BRANCH_COOKIE)?.value || null;
  let activeBranchId: string | null = null;
  if (picked) {
    const ok = base.branchIds
      ? base.branchIds.includes(picked)
      : !!(await db.branch.findFirst({ where: { id: picked, centerId: user.centerId }, select: { id: true } }));
    if (ok) activeBranchId = picked;
  }
  const cookieLang = jar.get(LANG_COOKIE)?.value;
  const locale: Locale = isLocale(cookieLang) ? cookieLang : isLocale(user.locale) ? user.locale : isLocale(user.center.locale) ? user.center.locale : "uz";
  return { ctx: buildCtx(user, { activeBranchId, locale }), disabled: false };
});

export const getCtx = async (): Promise<Ctx | null> => (await loadCtx()).ctx;

function toLogin(disabled: boolean): never {
  redirect(disabled ? "/login?disabled=1" : "/login");
}

/** For pages: redirect to login without a session, show 403 without the permission. */
export async function requireCtx(perm?: Perm): Promise<Ctx> {
  const { ctx, disabled } = await loadCtx();
  if (!ctx) toLogin(disabled);
  if (perm && !ctx.can(perm)) redirect("/forbidden");
  return ctx;
}

/** Staff only (not a pure teacher). Teachers are sent to their own pages. */
export async function requireStaff(perm?: Perm): Promise<Ctx> {
  const ctx = await requireCtx(perm);
  if (ctx.role === "TEACHER") redirect("/t");
  return ctx;
}

/** For server actions: throw instead of redirecting on missing permission. */
export async function actionCtx(perm?: Perm): Promise<Ctx> {
  const { ctx, disabled } = await loadCtx();
  if (!ctx) toLogin(disabled);
  if (perm && !ctx.can(perm)) throw new UserError("error.forbidden");
  return ctx;
}

