"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cx } from "./ui";

export function NavLink({ href, children }: { href: string; children: ReactNode }) {
  const path = usePathname();
  const active = href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
  return (
    <Link href={href} className={cx("flex items-center gap-2 rounded-lg px-2 py-1.5 text-sm", active ? "bg-accent/10 font-medium text-accent" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900")}>
      {children}
    </Link>
  );
}
