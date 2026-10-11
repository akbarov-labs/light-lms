"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cx } from "./ui";

export function Tabs({ items }: { items: { href: string; label: string; exact?: boolean }[] }) {
  const path = usePathname();
  return (
    <div className="mb-5 flex gap-1 overflow-x-auto border-b border-slate-200">
      {items.map((i) => {
        const active = i.exact ? path === i.href : path === i.href || path.startsWith(`${i.href}/`);
        return (
          <Link key={i.href} href={i.href} className={cx("whitespace-nowrap border-b-2 px-3 py-2 text-sm", active ? "border-accent font-medium text-accent" : "border-transparent text-slate-500 hover:text-slate-800")}>
            {i.label}
          </Link>
        );
      })}
    </div>
  );
}
