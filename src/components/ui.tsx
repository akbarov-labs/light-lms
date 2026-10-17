import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";
import { ChevronLeft, Inbox } from "lucide-react";
import { formatMoney } from "@/lib/money";
import { DocTitle } from "./doc-title";

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(" ");
}

export function PageHeader({
  title,
  subtitle,
  actions,
  back,
  docTitle,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  back?: { href: string; label: string };
  /** Browser tab title; defaults to the title when it is plain text. */
  docTitle?: string;
}) {
  const tabTitle = docTitle ?? (typeof title === "string" ? title : undefined);
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
      {tabTitle && <DocTitle title={tabTitle} />}
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-1.5 inline-flex items-center gap-1 text-[13px] text-zinc-500 transition-colors hover:text-zinc-900">
            <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
            {back.label}
          </Link>
        )}
        <h1 className="truncate text-[22px] font-semibold leading-tight tracking-[-0.02em] text-zinc-950">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-zinc-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className, pad = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx("min-w-0 overflow-hidden rounded-xl border border-line bg-white", className)}>
      {(title || actions) && (
        <header className="flex min-h-[48px] flex-wrap items-center justify-between gap-2 border-b border-zinc-100 px-4 py-2.5">
          {title && <h2 className="text-[13px] font-semibold text-zinc-900">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={pad ? "p-4" : ""}>{children}</div>
    </section>
  );
}

const tones = {
  gray: ["bg-zinc-100 text-zinc-700", "bg-zinc-400"],
  green: ["bg-emerald-50 text-emerald-800", "bg-emerald-500"],
  red: ["bg-red-50 text-red-700", "bg-red-500"],
  amber: ["bg-amber-50 text-amber-800", "bg-amber-500"],
  blue: ["bg-sky-50 text-sky-800", "bg-sky-500"],
  violet: ["bg-violet-50 text-violet-700", "bg-violet-500"],
} as const;
export type Tone = keyof typeof tones;

export function Badge({ tone = "gray", children, dot = true }: { tone?: Tone; children: ReactNode; dot?: boolean }) {
  return (
    <span className={cx("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium", tones[tone][0])}>
      {dot && <span className={cx("h-1.5 w-1.5 shrink-0 rounded-full", tones[tone][1])} aria-hidden />}
      {children}
    </span>
  );
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    // focusable so keyboard users can scroll a table that is wider than a phone
    <div tabIndex={0} className={cx("overflow-x-auto focus-visible:-outline-offset-2", className)}>
      <table className="w-full min-w-full border-collapse text-sm text-zinc-700">{children}</table>
    </div>
  );
}
export function Th({ children, className, ...rest }: ComponentProps<"th">) {
  return (
    <th {...rest} className={cx("h-9 whitespace-nowrap border-b border-zinc-100 bg-zinc-50/70 px-3 text-left text-xs font-medium text-zinc-500 first:pl-4 last:pr-4", className)}>
      {children}
    </th>
  );
}
export function Td({ children, className, ...rest }: ComponentProps<"td">) {
  return (
    <td {...rest} className={cx("px-3 py-2.5 align-middle first:pl-4 last:pr-4", className)}>
      {children}
    </td>
  );
}
/** `muted` marks a closed row (archived, ended, reversed): body text drops to zinc-500, never an opacity fade (that fails contrast). */
export function Tr({ children, className, muted }: { children: ReactNode; className?: string; muted?: boolean }) {
  return <tr className={cx("border-b border-zinc-100 transition-colors last:border-0 hover:bg-zinc-50/70", muted && "text-zinc-500", className)}>{children}</tr>;
}

/** Right-aligned money cell content; debts read red, credits green when asked. */
export function Money({ amount, tone, className }: { amount: number; tone?: "debt" | "credit" | "auto"; className?: string }) {
  const color =
    tone === "debt" ? (amount > 0 ? "text-red-600" : "text-zinc-500") : tone === "credit" ? "text-emerald-700" : tone === "auto" ? (amount < 0 ? "text-red-600" : amount > 0 ? "text-emerald-700" : "text-zinc-500") : "";
  return <span className={cx("tnum whitespace-nowrap", color, className)}>{formatMoney(amount)}</span>;
}

/** Empty list: what is missing and, when there is one, the next action (never just "no data"). */
export function EmptyState({ children, icon, title, action, compact }: { children?: ReactNode; icon?: ReactNode; title?: ReactNode; action?: ReactNode; compact?: boolean }) {
  return (
    <div className={cx("flex flex-col items-center gap-2 px-4 text-center text-sm text-zinc-500", compact ? "py-8" : "py-12")}>
      <span className="text-zinc-300" aria-hidden>{icon ?? <Inbox className="h-6 w-6" strokeWidth={1.5} />}</span>
      {title && <div className="text-[15px] font-medium text-zinc-900">{title}</div>}
      {children && <div className="max-w-sm leading-relaxed">{children}</div>}
      {action && <div className="mt-2 flex flex-wrap justify-center gap-2">{action}</div>}
    </div>
  );
}

export function Stat({ label, value, hint, tone, href }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: "red" | "green" | "amber"; href?: string }) {
  const body = (
    <div className={cx("h-full rounded-xl border border-line bg-white px-4 py-3.5", href && "transition-colors hover:border-zinc-300")}>
      <div className="text-[13px] text-zinc-500">{label}</div>
      <div className={cx("tnum mt-1 truncate text-xl font-semibold leading-tight tracking-[-0.02em] text-zinc-950 2xl:text-[22px]", tone === "red" && "text-red-600!", tone === "green" && "text-emerald-700!", tone === "amber" && "text-amber-700!")}>{value}</div>
      {hint && <div className="mt-1 text-xs text-zinc-500">{hint}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block rounded-xl">
      {body}
    </Link>
  ) : (
    body
  );
}

const btn = {
  primary: "bg-accent text-accent-fg hover:brightness-[0.94] active:brightness-90",
  secondary: "border border-zinc-200 bg-white text-zinc-800 hover:border-zinc-300 hover:bg-zinc-50",
  danger: "bg-red-600 text-white hover:bg-red-700",
  ghost: "text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900",
} as const;
export type ButtonVariant = keyof typeof btn;

export function buttonClass(variant: ButtonVariant = "primary", size: "sm" | "md" = "md"): string {
  return cx(
    "inline-flex select-none items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-medium transition-[background-color,border-color,filter,color] disabled:pointer-events-none disabled:opacity-50",
    size === "sm" ? "h-8 px-2.5 text-[13px]" : "h-9 px-3.5 text-sm",
    btn[variant],
  );
}

export function LinkButton({ href, children, variant = "primary", size = "md", ...rest }: { href: string; children: ReactNode; variant?: ButtonVariant; size?: "sm" | "md" } & Omit<ComponentProps<typeof Link>, "href" | "className">) {
  // API routes (CSV exports) are downloads, not pages: a <Link> would prefetch them as RSC, and that
  // never-settling prefetch stalled every later client navigation on the page.
  if (href.startsWith("/api/")) {
    return (
      <a href={href} className={buttonClass(variant, size)} {...(rest as ComponentProps<"a">)}>
        {children}
      </a>
    );
  }
  return (
    <Link href={href} className={buttonClass(variant, size)} {...rest}>
      {children}
    </Link>
  );
}

/** Builds ?page=N links that keep the other query params. */
export function Pagination({ page, pages, params, path, t }: { page: number; pages: number; params: Record<string, string | undefined>; path: string; t: (k: "common.prev" | "common.next" | "common.page", v?: Record<string, string | number>) => string }) {
  if (pages <= 1) return null;
  const href = (p: number) => {
    const q = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) if (v && k !== "page") q.set(k, v);
    q.set("page", String(p));
    return `${path}?${q.toString()}`;
  };
  return (
    <div className="flex items-center justify-between gap-2 border-t border-zinc-100 px-4 py-2.5 text-[13px] text-zinc-500">
      <span className="tnum">{t("common.page", { page, pages })}</span>
      <div className="flex gap-2">
        {page > 1 && <LinkButton variant="secondary" size="sm" href={href(page - 1)}>{t("common.prev")}</LinkButton>}
        {page < pages && <LinkButton variant="secondary" size="sm" href={href(page + 1)}>{t("common.next")}</LinkButton>}
      </div>
    </div>
  );
}

export function KV({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-3 text-sm sm:grid-cols-2">
      {items.map(([k, v], i) => (
        <div key={i} className="flex min-w-0 justify-between gap-3 sm:block">
          <dt className="text-[13px] text-zinc-500">{k}</dt>
          <dd className="min-w-0 text-right font-medium text-zinc-900 sm:mt-0.5 sm:text-left">{v}</dd>
        </div>
      ))}
    </dl>
  );
}

/** Filter bar: wraps instead of overflowing, every control labelled. */
export function FilterBar({ children }: { children: ReactNode }) {
  return <form className="mb-4 flex flex-wrap items-end gap-2 *:min-w-0">{children}</form>;
}
