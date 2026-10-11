import type { ReactNode } from "react";
import type { Ctx } from "@/lib/ctx";
import type { DictKey } from "@/lib/i18n";
import type { Perm } from "@/lib/perms";
import { db } from "@/lib/db";
import { hexToRgbTriplet } from "@/lib/color";
import { logoutAction, setBranchAction, setLangAction } from "@/app/actions";
import { AutoSubmitSelect, MobileNavToggle } from "./client";
import { NavLink } from "./nav-link";

interface NavItem {
  href: string;
  key: DictKey;
  icon: string;
  any?: Perm[];
  staffOnly?: boolean;
  teacherOnly?: boolean;
}

const NAV: NavItem[] = [
  { href: "/", key: "nav.dashboard", icon: "◧", any: ["finance.view"] },
  { href: "/today", key: "nav.today", icon: "☀", staffOnly: true },
  { href: "/leads", key: "nav.leads", icon: "✦", any: ["leads"] },
  { href: "/students", key: "nav.students", icon: "☺", staffOnly: true },
  { href: "/groups", key: "nav.groups", icon: "▦", staffOnly: true },
  { href: "/courses", key: "nav.courses", icon: "❖", staffOnly: true },
  { href: "/payments", key: "nav.payments", icon: "₪", any: ["payments.take", "finance.view"] },
  { href: "/debtors", key: "nav.debtors", icon: "!", any: ["payments.take", "finance.view"] },
  { href: "/salary", key: "nav.salary", icon: "$", any: ["finance.view"] },
  { href: "/expenses", key: "nav.expenses", icon: "↧", any: ["finance.view"] },
  { href: "/reports", key: "nav.reports", icon: "▤", any: ["finance.view"] },
  { href: "/audit", key: "nav.audit", icon: "≡", any: ["finance.view", "settings"] },
  { href: "/settings", key: "nav.settings", icon: "⚙", any: ["settings", "staff.manage"] },
  { href: "/t", key: "nav.teacher", icon: "✎", teacherOnly: true },
];

export function visibleNav(ctx: Ctx): NavItem[] {
  return NAV.filter((n) => {
    if (n.teacherOnly) return ctx.isTeacher;
    if (ctx.role === "TEACHER") return false;
    if (n.any) return n.any.some((p) => ctx.can(p));
    return true;
  });
}

function Nav({ ctx }: { ctx: Ctx }) {
  return (
    <nav className="flex flex-col gap-0.5 p-3">
      <div className="mb-3 px-2">
        <div className="truncate text-sm font-semibold text-slate-900">{ctx.center.name}</div>
        <div className="text-xs text-slate-500">{ctx.t("app.name")}</div>
      </div>
      {visibleNav(ctx).map((n) => (
        <NavLink key={n.href} href={n.href}>
          <span className="w-4 text-center text-slate-400">{n.icon}</span>
          {ctx.t(n.key)}
        </NavLink>
      ))}
    </nav>
  );
}

export async function AdminShell({ ctx, children }: { ctx: Ctx; children: ReactNode }) {
  const branches = await db.branch.findMany({
    where: { centerId: ctx.centerId, archivedAt: null, ...(ctx.branchIds ? { id: { in: ctx.branchIds } } : {}) },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
  const { t } = ctx;
  return (
    <div style={{ ["--accent" as string]: hexToRgbTriplet(ctx.center.accentColor) }} className="min-h-screen">
      <aside className="fixed inset-y-0 left-0 hidden w-60 overflow-y-auto border-r border-slate-200 bg-white lg:block print:hidden">
        <Nav ctx={ctx} />
      </aside>
      <div className="lg:pl-60">
        <header className="sticky top-0 z-30 flex items-center gap-2 border-b border-slate-200 bg-white/90 px-3 py-2 backdrop-blur sm:px-6 print:hidden">
          <MobileNavToggle>
            <Nav ctx={ctx} />
          </MobileNavToggle>
          <form action={setBranchAction} className="min-w-0">
            <AutoSubmitSelect name="branchId" defaultValue={ctx.activeBranchId ?? ""} className="max-w-[11rem] rounded-lg border border-slate-300 bg-white py-1.5 pl-2 pr-7 text-sm" aria-label={t("common.branch")}>
              {(!ctx.branchIds || ctx.branchIds.length > 1) && <option value="">{t("common.allBranches")}</option>}
              {branches.map((b) => (
                <option key={b.id} value={b.id}>{b.name}</option>
              ))}
            </AutoSubmitSelect>
          </form>
          <form action="/students" className="hidden flex-1 sm:block">
            <input name="q" placeholder={`${t("common.search")}: ${t("nav.students").toLowerCase()}…`} className="w-full max-w-xs rounded-lg border border-slate-300 px-3 py-1.5 text-sm" />
          </form>
          <div className="ml-auto flex items-center gap-1">
            <form action={setLangAction} className="flex rounded-lg border border-slate-200 text-xs">
              {(["uz", "ru"] as const).map((l) => (
                <button key={l} name="lang" value={l} className={l === ctx.locale ? "rounded-md bg-slate-900 px-2 py-1 font-semibold text-white" : "px-2 py-1 text-slate-500 hover:text-slate-900"}>
                  {l.toUpperCase()}
                </button>
              ))}
            </form>
            <span className="hidden text-sm text-slate-600 md:inline">{ctx.userName}</span>
            <span className="hidden text-xs text-slate-400 md:inline">· {t(`role.${ctx.role}`)}</span>
            <form action={logoutAction}>
              <button className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100 hover:text-slate-900">{t("common.logout")}</button>
            </form>
          </div>
        </header>
        <main className="mx-auto max-w-7xl px-3 py-5 sm:px-6">{children}</main>
      </div>
    </div>
  );
}
