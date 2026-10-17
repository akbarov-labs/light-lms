import type { ReactNode } from "react";
import type { LucideIcon } from "lucide-react";
import {
  BarChart3,
  BookOpen,
  Building2,
  CircleAlert,
  Banknote,
  LayoutDashboard,
  Receipt,
  ScrollText,
  Settings,
  Smartphone,
  Sun,
  UserPlus,
  Users,
  UsersRound,
  Wallet,

} from "lucide-react";
import type { Ctx } from "@/lib/ctx";
import type { DictKey } from "@/lib/i18n";
import type { Perm } from "@/lib/perms";
import { db } from "@/lib/db";
import { accentVars } from "@/lib/color";
import { demoMode, signupHref } from "@/config/brand";
import { setBranchAction } from "@/app/actions";
import { AutoSubmitSelect, CloseLabelProvider, SavedLabelProvider, Toaster } from "./client";
import { CommandPalette, QuickPayButton, SearchTrigger } from "./command-palette";
import { MobileNav, NavLink, UserMenu } from "./nav-link";
import { buttonClass } from "./ui";

interface NavItem {
  href: string;
  key: DictKey;
  icon: LucideIcon;
  any?: Perm[];
  teacherOnly?: boolean;
  unscopedOnly?: boolean;
  platformOnly?: boolean;
}

const NAV: { group?: DictKey; items: NavItem[] }[] = [
  {
    items: [
      { href: "/", key: "nav.dashboard", icon: LayoutDashboard, any: ["finance.view"] },
      { href: "/today", key: "nav.today", icon: Sun },
    ],
  },
  {
    group: "nav.group.crm",
    items: [
      { href: "/leads", key: "nav.leads", icon: UserPlus, any: ["leads"] },
      { href: "/students", key: "nav.students", icon: Users },
    ],
  },
  {
    group: "nav.group.study",
    items: [
      { href: "/groups", key: "nav.groups", icon: UsersRound },
      { href: "/courses", key: "nav.courses", icon: BookOpen },
    ],
  },
  {
    group: "nav.group.money",
    items: [
      { href: "/payments", key: "nav.payments", icon: Wallet, any: ["payments.take", "finance.view"] },
      { href: "/debtors", key: "nav.debtors", icon: CircleAlert, any: ["payments.take", "finance.view"] },
      { href: "/salary", key: "nav.salary", icon: Banknote, any: ["finance.view"] },
      { href: "/expenses", key: "nav.expenses", icon: Receipt, any: ["finance.view"] },
      { href: "/reports", key: "nav.reports", icon: BarChart3, any: ["finance.view"] },
    ],
  },
  {
    group: "nav.group.system",
    items: [
      { href: "/audit", key: "nav.audit", icon: ScrollText, any: ["finance.view", "settings"], unscopedOnly: true },
      { href: "/settings", key: "nav.settings", icon: Settings, any: ["settings", "staff.manage"] },
      { href: "/t", key: "nav.teacher", icon: Smartphone, teacherOnly: true },
      { href: "/platform", key: "nav.platform", icon: Building2, platformOnly: true },
    ],
  },
];

function allowed(ctx: Ctx, n: NavItem): boolean {
  if (n.platformOnly) return ctx.isPlatformAdmin;
  if (n.teacherOnly) return ctx.isTeacher;
  if (ctx.role === "TEACHER") return false;
  if (n.unscopedOnly && ctx.branchIds) return false;
  if (n.any) return n.any.some((p) => ctx.can(p));
  return true;
}

export function visibleNav(ctx: Ctx) {
  return NAV.map((g) => ({ ...g, items: g.items.filter((n) => allowed(ctx, n)) })).filter((g) => g.items.length > 0);
}

function Nav({ ctx }: { ctx: Ctx }) {
  return (
    <nav className="flex flex-col gap-5 px-3 py-4" aria-label={ctx.t("shell.menu")}>
      {visibleNav(ctx).map((g, gi) => (
        <div key={gi}>
          {g.group && <div className="mb-1 px-2.5 text-xs font-medium text-zinc-500">{ctx.t(g.group)}</div>}
          <div className="flex flex-col gap-0.5">
            {g.items.map((n) => {
              const Icon = n.icon;
              return (
                <NavLink key={n.href} href={n.href}>
                  <Icon className="h-4 w-4 shrink-0" strokeWidth={1.75} aria-hidden />
                  {ctx.t(n.key)}
                </NavLink>
              );
            })}
          </div>
        </div>
      ))}
    </nav>
  );
}

function CenterMark({ ctx }: { ctx: Ctx }) {
  return (
    <div className="flex items-center gap-2.5 px-5 py-4">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-sm font-semibold text-accent-fg" aria-hidden>
        {ctx.center.name.slice(0, 1)}
      </span>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold leading-tight text-zinc-950">{ctx.center.name}</div>
        <div className="truncate text-xs text-zinc-500">{ctx.userName}</div>
      </div>
    </div>
  );
}

export async function AdminShell({ ctx, children }: { ctx: Ctx; children: ReactNode }) {
  const branches = await db.branch.findMany({
    where: { centerId: ctx.centerId, archivedAt: null, ...(ctx.branchIds ? { id: { in: ctx.branchIds } } : {}) },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const { t } = ctx;
  const pages = visibleNav(ctx).flatMap((g) => g.items.map((n) => ({ href: n.href, label: t(n.key) })));
  return (
    <div style={accentVars(ctx.center.accentColor) as React.CSSProperties} className="min-h-screen">
      <SavedLabelProvider value={t("shell.saved")}>
        <CloseLabelProvider value={t("shell.close")}>
          <CommandPalette
            pages={pages}
            labels={{
              search: t("shell.search"),
              payTitle: t("shell.quickPayTitle"),
              students: t("shell.students"),
              groups: t("shell.groups"),
              pages: t("shell.pages"),
              noResults: t("shell.noResults"),
              typeMore: t("shell.typeMore"),
              hint: t("shell.navHint"),
              debt: t("students.familyDebt").toLowerCase(),
            }}
          >
            <aside className="fixed inset-y-0 left-0 hidden w-60 flex-col overflow-y-auto border-r border-line bg-white lg:flex print:hidden">
              <CenterMark ctx={ctx} />
              <Nav ctx={ctx} />
            </aside>
            <div className="lg:pl-60">
              {demoMode() && (
                <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 bg-zinc-900 px-4 py-2 text-center text-[13px] text-zinc-300 print:hidden">
                  <span>{t("demo.banner")}</span>
                  <a href={signupHref()} className="font-medium text-white underline decoration-zinc-500 underline-offset-4 hover:decoration-white">{t("demo.create")}</a>
                </div>
              )}
              <header className="sticky top-0 z-30 flex h-14 items-center gap-2 border-b border-line bg-white/90 px-3 backdrop-blur-md sm:gap-3 sm:px-6 print:hidden">
                <MobileNav label={t("shell.menu")} closeLabel={t("shell.close")}>
                  <CenterMark ctx={ctx} />
                  <Nav ctx={ctx} />
                </MobileNav>
                <div className="hidden min-w-0 flex-1 sm:block">
                  <SearchTrigger label={t("shell.search")} />
                </div>
                <div className="ml-auto flex items-center gap-2">
                  {ctx.can("payments.take") && (
                    <QuickPayButton label={t("shell.quickPay")} className={buttonClass("primary", "sm")} />
                  )}
                  {branches.length > 0 && (
                    <form action={setBranchAction}>
                      <AutoSubmitSelect
                        // React resets a form after its action; keyed by the branch, the select remounts with the
                        // new default instead of being reset to the branch it was first rendered with
                        key={ctx.activeBranchId ?? "all"}
                        name="branchId"
                        defaultValue={ctx.activeBranchId ?? ""}
                        className="h-8 max-w-40 rounded-lg border border-zinc-200 bg-white pl-2.5 pr-7 text-[13px] text-zinc-700 hover:border-zinc-300"
                        aria-label={t("common.branch")}
                      >
                        {(!ctx.branchIds || ctx.branchIds.length > 1) && <option value="">{t("common.allBranches")}</option>}
                        {branches.map((b) => (
                          <option key={b.id} value={b.id}>{b.name}</option>
                        ))}
                      </AutoSubmitSelect>
                    </form>
                  )}
                  <UserMenu name={ctx.userName} role={t(`role.${ctx.role}`)} locale={ctx.locale} logoutLabel={t("common.logout")} languageLabel={t("common.language")} accountLabel={t("shell.account")} passwordLabel={t("auth.changeOwn")} />
                </div>
              </header>
              <div className="border-b border-line bg-white px-3 py-2 sm:hidden print:hidden">
                <SearchTrigger label={t("shell.searchShort")} />
              </div>
              <main className="mx-auto max-w-[1280px] px-4 py-6 sm:px-6 lg:px-8">{children}</main>
            </div>
            <Toaster />
          </CommandPalette>
        </CloseLabelProvider>
      </SavedLabelProvider>
    </div>
  );
}

