import Link from "next/link";
import type { ReactNode } from "react";
import { CalendarDays, FileText, LayoutDashboard, Sun, Wallet } from "lucide-react";
import { requireCtx } from "@/lib/ctx";
import { accentVars } from "@/lib/color";
import { CloseLabelProvider, SavedLabelProvider, Toaster } from "@/components/client";
import { UserMenu } from "@/components/nav-link";
import { TabLink } from "./tab-link";

export const dynamic = "force-dynamic";

export default async function TeacherLayout({ children }: { children: ReactNode }) {
  const ctx = await requireCtx();
  const { t } = ctx;
  return (
    <div style={accentVars(ctx.center.accentColor) as React.CSSProperties} className="mx-auto min-h-screen max-w-2xl pb-24">
      <SavedLabelProvider value={t("shell.saved")}>
        <CloseLabelProvider value={t("shell.close")}>
          <header className="sticky top-0 z-20 flex h-14 items-center gap-2 border-b border-line bg-white/95 px-4 backdrop-blur-md">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-sm font-semibold text-accent-fg" aria-hidden>{ctx.center.name.slice(0, 1)}</span>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold leading-tight">{ctx.userName}</div>
              <div className="truncate text-xs text-zinc-500">{ctx.center.name}</div>
            </div>
            {ctx.role !== "TEACHER" && (
              <Link href="/" className="flex h-11 w-11 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100" aria-label={t("t.admin")}>
                <LayoutDashboard className="h-5 w-5" aria-hidden />
              </Link>
            )}
            <UserMenu name={ctx.userName} role={t(`role.${ctx.role}`)} locale={ctx.locale} logoutLabel={t("common.logout")} languageLabel={t("common.language")} accountLabel={t("shell.account")} passwordLabel={t("auth.changeOwn")} />
          </header>
          <main className="px-4 py-5">{ctx.isTeacher ? children : <p className="py-10 text-center text-zinc-500">{t("t.notTeacher")}</p>}</main>
          <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-line bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md" aria-label={t("shell.menu")}>
            <div className="mx-auto grid max-w-2xl grid-cols-4">
              <TabLink href="/t" icon={<Sun className="h-5 w-5" aria-hidden />} label={t("t.today")} />
              <TabLink href="/t/week" icon={<CalendarDays className="h-5 w-5" aria-hidden />} label={t("t.week")} />
              <TabLink href="/t/reports" icon={<FileText className="h-5 w-5" aria-hidden />} label={t("t.reports")} />
              <TabLink href="/t/salary" icon={<Wallet className="h-5 w-5" aria-hidden />} label={t("t.salary")} />
            </div>
          </nav>
          <Toaster />
        </CloseLabelProvider>
      </SavedLabelProvider>
    </div>
  );
}
