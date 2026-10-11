import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

export function cx(...c: (string | false | null | undefined)[]): string {
  return c.filter(Boolean).join(" ");
}

export function PageHeader({ title, subtitle, actions, back }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: { href: string; label: string } }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {back && (
          <Link href={back.href} className="mb-1 inline-block text-sm text-slate-500 hover:text-slate-800">
            ← {back.label}
          </Link>
        )}
        <h1 className="truncate text-xl font-semibold text-slate-900 sm:text-2xl">{title}</h1>
        {subtitle && <div className="mt-1 text-sm text-slate-500">{subtitle}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

export function Card({ title, actions, children, className, pad = true }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string; pad?: boolean }) {
  return (
    <section className={cx("rounded-xl border border-slate-200 bg-white shadow-sm", className)}>
      {(title || actions) && (
        <header className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          {title && <h2 className="text-sm font-semibold text-slate-800">{title}</h2>}
          {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
        </header>
      )}
      <div className={pad ? "p-4" : ""}>{children}</div>
    </section>
  );
}

const tones = {
  gray: "bg-slate-100 text-slate-700",
  green: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  red: "bg-rose-50 text-rose-700 ring-rose-600/20",
  amber: "bg-amber-50 text-amber-800 ring-amber-600/20",
  blue: "bg-sky-50 text-sky-700 ring-sky-600/20",
  violet: "bg-violet-50 text-violet-700 ring-violet-600/20",
} as const;
export type Tone = keyof typeof tones;

export function Badge({ tone = "gray", children }: { tone?: Tone; children: ReactNode }) {
  return <span className={cx("inline-flex items-center whitespace-nowrap rounded-md px-2 py-0.5 text-xs font-medium ring-1 ring-inset ring-slate-500/10", tones[tone])}>{children}</span>;
}

export function Table({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div className={cx("overflow-x-auto", className)}>
      <table className="min-w-full divide-y divide-slate-200 text-sm">{children}</table>
    </div>
  );
}
export function Th({ children, className, ...rest }: ComponentProps<"th">) {
  return (
    <th {...rest} className={cx("whitespace-nowrap bg-slate-50 px-3 py-2 text-left text-xs font-semibold uppercase tracking-wide text-slate-500", className)}>
      {children}
    </th>
  );
}
export function Td({ children, className, ...rest }: ComponentProps<"td">) {
  return (
    <td {...rest} className={cx("px-3 py-2 align-top text-slate-700", className)}>
      {children}
    </td>
  );
}
export function Tr({ children, className }: { children: ReactNode; className?: string }) {
  return <tr className={cx("border-b border-slate-100 last:border-0 hover:bg-slate-50/60", className)}>{children}</tr>;
}

export function EmptyState({ children }: { children: ReactNode }) {
  return <div className="px-4 py-10 text-center text-sm text-slate-500">{children}</div>;
}

export function Stat({ label, value, hint, tone, href }: { label: ReactNode; value: ReactNode; hint?: ReactNode; tone?: "red" | "green" | "amber"; href?: string }) {
  const body = (
    <div className="rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      <div className={cx("mt-1 break-words text-lg font-semibold tabular-nums xl:text-2xl", tone === "red" && "text-rose-600", tone === "green" && "text-emerald-600", tone === "amber" && "text-amber-600")}>{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
  return href ? (
    <Link href={href} className="block transition hover:-translate-y-0.5">
      {body}
    </Link>
  ) : (
    body
  );
}

const btn = {
  primary: "bg-accent text-accent-fg hover:opacity-90",
  secondary: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
  danger: "bg-rose-600 text-white hover:bg-rose-700",
  ghost: "text-slate-600 hover:bg-slate-100",
} as const;
export type ButtonVariant = keyof typeof btn;

export function buttonClass(variant: ButtonVariant = "primary", size: "sm" | "md" = "md"): string {
  return cx(
    "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium shadow-sm transition disabled:cursor-not-allowed disabled:opacity-50",
    size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-2 text-sm",
    btn[variant],
  );
}

export function LinkButton({ href, children, variant = "primary", size = "md", ...rest }: { href: string; children: ReactNode; variant?: ButtonVariant; size?: "sm" | "md" } & Omit<ComponentProps<typeof Link>, "href" | "className">) {
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
    <div className="flex items-center justify-between gap-2 border-t border-slate-100 px-3 py-2 text-sm text-slate-600">
      <span>{t("common.page", { page, pages })}</span>
      <div className="flex gap-2">
        {page > 1 && <LinkButton variant="secondary" size="sm" href={href(page - 1)}>{t("common.prev")}</LinkButton>}
        {page < pages && <LinkButton variant="secondary" size="sm" href={href(page + 1)}>{t("common.next")}</LinkButton>}
      </div>
    </div>
  );
}

export function KV({ items }: { items: [ReactNode, ReactNode][] }) {
  return (
    <dl className="grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
      {items.map(([k, v], i) => (
        <div key={i} className="flex justify-between gap-3 border-b border-slate-100 py-1.5 sm:block sm:border-0 sm:py-0">
          <dt className="text-slate-500">{k}</dt>
          <dd className="text-right font-medium text-slate-800 sm:text-left">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
