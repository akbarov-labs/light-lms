// Context core: who is acting, which center/branches they may touch, which language.
// Framework-free so the worker and bot can use it; ctx.ts adds the request (cookies) side.
import { db } from "./db";
import { allowedBranches, effectivePerms, type Perm, type RoleName } from "./perms";
import { makeT, type Locale, type TFn } from "./i18n";
import { readSettings, type CenterSettings } from "./settings";
import { UserError } from "./user-error";
import { isPlatformAdmin } from "./platform";

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
  /** Listed in PLATFORM_ADMIN_PHONES: may open /platform (all centers). */
  isPlatformAdmin: boolean;
}

export { UserError };

type UserWithCenter = NonNullable<Awaited<ReturnType<typeof loadUser>>>;

export function loadUser(userId: string) {
  return db.user.findUnique({ where: { id: userId }, include: { branches: { select: { branchId: true } }, center: true } });
}

/** Build a context for a loaded user (request or worker). */
export function buildCtx(user: UserWithCenter, opts: { activeBranchId?: string | null; locale?: Locale } = {}): Ctx {
  const role = user.role as RoleName;
  const perms = effectivePerms(role, user.perms);
  const branchIds = allowedBranches(role, user.branches.map((b) => b.branchId));
  const locale: Locale = opts.locale ?? (user.locale === "ru" ? "ru" : user.center.locale === "ru" && !user.locale ? "ru" : "uz");
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
    activeBranchId: opts.activeBranchId ?? null,
    locale,
    t: makeT(locale),
    can: (p) => perms.has(p),
    isPlatformAdmin: isPlatformAdmin(user.phone),
  };
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

/** Staff member inside this user's branches (owners and unscoped users see everyone). */
export function staffInScope(ctx: Ctx, userBranchIds: string[]): boolean {
  if (!ctx.branchIds) return true;
  return userBranchIds.length > 0 && userBranchIds.every((b) => ctx.branchIds!.includes(b));
}

/** A teacher whose salary this user may see/change: unscoped, or teaching in one of the user's branches. */
export async function assertTeacherAccess(ctx: Ctx, teacherId: string): Promise<void> {
  const t = await db.user.findFirst({ where: { id: teacherId, centerId: ctx.centerId }, include: { branches: { select: { branchId: true } } } });
  if (!t) throw new UserError("error.notFound");
  if (ctx.branchIds && !t.branches.some((b) => ctx.branchIds!.includes(b.branchId))) throw new UserError("error.notFound");
}
