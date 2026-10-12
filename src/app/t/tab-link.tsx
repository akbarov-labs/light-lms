"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { cx } from "@/components/ui";

export function TabLink({ href, icon, label }: { href: string; icon: ReactNode; label: string }) {
  const path = usePathname();
  const active = href === "/t" ? path === "/t" || path.startsWith("/t/lessons") : path.startsWith(href);
  return (
    <Link href={href} aria-current={active ? "page" : undefined} className={cx("flex h-16 flex-col items-center justify-center gap-1 text-xs font-medium transition-colors", active ? "text-zinc-950 [&>svg]:text-accent" : "text-zinc-500 hover:text-zinc-900")}>
      {icon}
      {label}
    </Link>
  );
}
