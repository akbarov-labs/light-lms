import Link from "next/link";
import { BRAND } from "@/config/brand";
import type { ReactNode } from "react";

/** Centered card used by the login, password reset and forced password change pages. */
export function AuthCard({ title, subtitle, children, footer }: { title: string; subtitle?: string; children: ReactNode; footer?: ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <Link href="/" aria-label={BRAND.name} className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-900 text-base font-semibold text-white">{BRAND.name.slice(0, 1).toUpperCase()}</Link>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em]">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-zinc-500">{subtitle}</p>}
        </div>
        <div className="rounded-2xl border border-line bg-white p-6">{children}</div>
        {footer}
      </div>
    </main>
  );
}
