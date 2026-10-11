// Request context: who is calling, which center/branches they may touch, which language.
// Every page and server action starts with requireCtx(perm?) — HANDOFF §16.
import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { db } from "./db";
import { allowedBranches, effectivePerms, type Perm, type RoleName } from "./perms";
import { SESSION_COOKIE, verifySession } from "./session";
import { isLocale, LANG_COOKIE, makeT, type Locale, type TFn } from "./i18n";
import { readSettings, type CenterSettings } from "./settings";
import { UserError } from "./user-error";

export const BRANCH_COOKIE = "branch";

export interface Ctx {
  userId: string;
  userName: string;
  role: RoleName;
  isTeacher: boolean;
  centerId: string;
  center: { id: string; name: string; slug: string; accentColor: string; phone: string | null; paymeEnabled: boolean };
  settings: CenterSettings;
  perms: Set<Perm>;
  /** Branches this user may see; null = all branches of the center. */
  branchIds: string[] | null;
  /** Branch picked in the top-bar switcher (always inside branchIds), or null = all allowed. */
  activeBranchId: string | null;
  locale: Locale;
  t: TFn;
  can: (p: Perm) => boolean;
}

export { UserError };

export const getCtx = cache(async (): Promise<Ctx | null> => {
  const jar = await cookies();
  const session = await verifySession(jar.get(SESSION_COOKIE)?.value);
  if (!session) return null;
  const user = await db.user.findUnique({
    where: { id: session.sub },
    include: { branches: { select: { branchId: true } }, center: true },
  });
  if (!user || user.archivedAt || user.centerId !== session.cid) return null;

  const role = user.role as RoleName;
  const perms = effectivePerms(role, user.perms);
  const branchIds = allowedBranches(role, user.branches.map((b) => b.branchId));
  const picked = jar.get(BRANCH_COOKIE)?.value || null;
  let activeBranchId: string | null = null;
  if (picked) {
    const ok = branchIds
      ? branchIds.includes(picked)
      : !!(await db.branch.findFirst({ where: { id: picked, centerId: user.centerId }, select: { id: true } }));
    if (ok) activeBranchId = picked;
  }
  const cookieLang = jar.get(LANG_COOKIE)?.value;
  const locale: Locale = isLocale(cookieLang) ? cookieLang : isLocale(user.locale) ? user.locale : isLocale(user.center.locale) ? user.center.locale : "uz";

  return {
    userId: user.id,
    userName: user.name,
    role,
    isTeacher: user.isTeacher || role === "TEACHER",
    centerId: user.centerId,
    center: {
      id: user.center.id,
      name: user.center.name,
      slug: user.center.slug,
      accentColor: user.center.accentColor,
      phone: user.center.phone,
      paymeEnabled: !!(user.center.paymeMerchantId && user.center.paymeKey),
    },
    settings: readSettings(user.center.settings),
    perms,
    branchIds,
    activeBranchId,
    locale,
    t: makeT(locale),
    can: (p) => perms.has(p),
  };
});

/** For pages: redirect to login without a session, show 403 without the permission. */
export async function requireCtx(perm?: Perm): Promise<Ctx> {
  const ctx = await getCtx();
  if (!ctx) redirect("/login");
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
  const ctx = await getCtx();
  if (!ctx) redirect("/login");
  if (perm && !ctx.can(perm)) throw new UserError("error.forbidden");
  return ctx;
}

/** Branch ids a list query should be limited to (active switcher choice, else allowed set). */
export function scopeBranchIds(ctx: Ctx): string[] | null {
  if (ctx.activeBranchId) return [ctx.activeBranchId];
  return ctx.branchIds;
}

/** Prisma `where` fragment for models with a branchId column. */
export function branchWhere(ctx: Ctx): { branchId?: { in: string[] } } {
  const ids = scopeBranchIds(ctx);
  return ids ? { branchId: { in: ids } } : {};
}

/** Can this user touch something in the given branch? */
export function canAccessBranch(ctx: Ctx, branchId: string | null | undefined): boolean {
  if (!ctx.branchIds) return true;
  return !!branchId && ctx.branchIds.includes(branchId);
}

export function assertBranch(ctx: Ctx, branchId: string | null | undefined): void {
  if (!canAccessBranch(ctx, branchId)) throw new UserError("error.forbidden");
}

/** Students visible in the current branch scope: home branch or any enrollment there. */
export function studentScope(ctx: Ctx): { OR?: object[] } {
  const ids = scopeBranchIds(ctx);
  if (!ids) return {};
  return { OR: [{ branchId: { in: ids } }, { enrollments: { some: { group: { branchId: { in: ids } } } } }] };
}

/** Same rule but against the user's allowed branches (not the switcher) — for access checks. */
function allowedStudentScope(ctx: Ctx): { OR?: object[] } {
  if (!ctx.branchIds) return {};
  return { OR: [{ branchId: { in: ctx.branchIds } }, { branchId: null }, { enrollments: { some: { group: { branchId: { in: ctx.branchIds } } } } }] };
}

export async function assertStudentAccess(ctx: Ctx, studentId: string): Promise<void> {
  const s = await db.student.findFirst({ where: { id: studentId, centerId: ctx.centerId, ...allowedStudentScope(ctx) }, select: { id: true } });
  if (!s) throw new UserError("error.notFound");
}

export async function assertFamilyAccess(ctx: Ctx, familyId: string): Promise<void> {
  const f = await db.family.findFirst({
    where: { id: familyId, centerId: ctx.centerId, ...(ctx.branchIds ? { students: { some: allowedStudentScope(ctx) } } : {}) },
    select: { id: true },
  });
  if (!f) throw new UserError("error.notFound");
}

/** Families visible in the current branch scope. */
export function familyScope(ctx: Ctx): object {
  const s = studentScope(ctx);
  return s.OR ? { students: { some: s } } : {};
}
