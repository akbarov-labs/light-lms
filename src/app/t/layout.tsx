import Link from "next/link";
import type { ReactNode } from "react";
import { requireCtx } from "@/lib/ctx";
import { hexToRgbTriplet } from "@/lib/color";
import { logoutAction, setLangAction } from "@/app/actions";
import { NavLink } from "@/components/nav-link";

export const dynamic = "force-dynamic";

export default async function TeacherLayout({ children }: { children: ReactNode }) {
  const ctx = await requireCtx();
  const { t } = ctx;
  return (
    <div style={{ ["--accent" as string]: hexToRgbTriplet(ctx.center.accentColor) }} className="mx-auto min-h-screen max-w-2xl pb-20">
      <header className="sticky top-0 z-20 flex items-center gap-2 border-b border-slate-200 bg-white/95 px-4 py-3 backdrop-blur">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold">{ctx.userName}</div>
          <div className="truncate text-xs text-slate-500">{ctx.center.name}</div>
        </div>
        {ctx.role !== "TEACHER" && <Link href="/" className="text-xs text-accent">{t("t.admin")}</Link>}
        <form action={setLangAction}>
          <button name="lang" value={ctx.locale === "uz" ? "ru" : "uz"} className="rounded-md border border-slate-200 px-2 py-1 text-xs">{ctx.locale === "uz" ? "RU" : "UZ"}</button>
        </form>
        <form action={logoutAction}><button className="text-xs text-slate-500">{t("common.logout")}</button></form>
      </header>
      <main className="px-4 py-4">{ctx.isTeacher ? children : <p className="py-10 text-center text-slate-500">{t("t.notTeacher")}</p>}</main>
      <nav className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white">
        <div className="mx-auto grid max-w-2xl grid-cols-3 gap-1 p-2 text-center">
          <NavLink href="/t">☀ {t("t.today")}</NavLink>
          <NavLink href="/t/week">📅 {t("t.week")}</NavLink>
          <NavLink href="/t/salary">💵 {t("t.salary")}</NavLink>
        </div>
      </nav>
    </div>
  );
}
