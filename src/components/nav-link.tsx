"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, KeyRound, LogOut, Menu, X } from "lucide-react";
import { logoutAction } from "@/app/actions";
import { LanguageOptions } from "./language-menu";
import { cx } from "./ui";

// Detail pages belong to their list in the nav (a family or lesson page highlights its parent).
const PARENT: Record<string, string> = { families: "/students", lessons: "/groups", r: "/payments" };

export function isActive(href: string, path: string): boolean {
  if (href === "/") return path === "/";
  const first = path.split("/")[1] ?? "";
  if (PARENT[first]) return PARENT[first] === href;
  return path === href || path.startsWith(`${href}/`);
}

export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const path = usePathname();
  const active = isActive(href, path);
  return (
    <Link
      href={href}
      aria-current={active ? "page" : undefined}
      className={cx(
        "flex h-9 items-center gap-2.5 rounded-lg px-2.5 text-sm transition-colors",
        active ? "bg-zinc-100 font-medium text-zinc-950 [&>svg]:text-accent" : "text-zinc-600 hover:bg-zinc-50 hover:text-zinc-950 [&>svg]:text-zinc-400",
      )}
    >
      {children}
    </Link>
  );
}

/** Off-canvas nav for phones and tablets. */
export function MobileNav({ children, label, closeLabel }: { children: ReactNode; label: string; closeLabel: string }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  return (
    <>
      <button type="button" className="-ml-1 flex h-11 w-11 items-center justify-center rounded-lg text-zinc-600 hover:bg-zinc-100 lg:hidden" onClick={() => setOpen(true)} aria-label={label} aria-expanded={open}>
        <Menu className="h-5 w-5" aria-hidden />
      </button>
      {open && (
        <div className="fixed inset-0 z-50 lg:hidden" role="dialog" aria-modal="true" aria-label={label}>
          <div className="absolute inset-0 bg-zinc-950/30" onClick={() => setOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[85vw] overflow-y-auto bg-white shadow-pop">
            <button type="button" onClick={() => setOpen(false)} className="absolute right-2 top-3 flex h-10 w-10 items-center justify-center rounded-lg text-zinc-500 hover:bg-zinc-100" aria-label={closeLabel}>
              <X className="h-5 w-5" aria-hidden />
            </button>
            {children}
          </div>
        </div>
      )}
    </>
  );
}

/** Account menu: language and sign-out live here, away from other controls. */
export function UserMenu({ name, role, locale, logoutLabel, languageLabel, accountLabel, passwordLabel }: { name: string; role: string; locale: "uz" | "ru"; logoutLabel: string; languageLabel: string; accountLabel: string; passwordLabel: string }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const off = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", off);
    document.addEventListener("keydown", esc);
    return () => {
      document.removeEventListener("mousedown", off);
      document.removeEventListener("keydown", esc);
    };
  }, [open]);
  const initials = name.split(/\s+/).map((p) => p[0]).slice(0, 2).join("").toUpperCase();
  return (
    <div ref={wrap} className="relative">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-haspopup="menu" aria-expanded={open} aria-label={accountLabel} className="flex h-10 items-center gap-1.5 rounded-lg pl-1 pr-1.5 hover:bg-zinc-100">
        <span className="flex h-8 w-8 items-center justify-center rounded-full bg-zinc-900 text-xs font-semibold text-white">{initials}</span>
        <ChevronDown className="hidden h-3.5 w-3.5 text-zinc-500 sm:block" aria-hidden />
      </button>
      {open && (
        <div role="menu" className="absolute right-0 top-11 z-40 w-60 animate-pop-in rounded-xl border border-line bg-white p-1.5 shadow-pop">
          <div className="px-2.5 py-2">
            <div className="truncate text-sm font-medium text-zinc-900">{name}</div>
            <div className="text-xs text-zinc-500">{role}</div>
          </div>
          <div className="my-1 h-px bg-zinc-100" />
          <div role="group" aria-label={languageLabel}>
            <div className="px-2.5 pb-1 pt-1.5 text-xs text-zinc-500">{languageLabel}</div>
            <LanguageOptions current={locale} />
          </div>
          <div className="my-1 h-px bg-zinc-100" />
          <Link href="/password" role="menuitem" onClick={() => setOpen(false)} className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-sm text-zinc-700 hover:bg-zinc-100">
            <KeyRound className="h-4 w-4 text-zinc-500" aria-hidden />
            {passwordLabel}
          </Link>
          <form action={logoutAction}>
            <button role="menuitem" className="flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-sm text-zinc-700 hover:bg-zinc-100">
              <LogOut className="h-4 w-4 text-zinc-500" aria-hidden />
              {logoutLabel}
            </button>
          </form>
        </div>
      )}
    </div>
  );
}
