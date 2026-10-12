import type { ComponentProps, ReactNode } from "react";
import { cx } from "./ui";

// 16px on phones (iOS does not zoom), 14px from sm up; 36px tall; placeholder 4.8:1.
const inputBase =
  "block w-full rounded-lg border border-zinc-200 bg-white px-3 text-base text-zinc-900 transition-[border-color,box-shadow] hover:border-zinc-300 focus:border-accent focus:outline-none focus:ring-[3px] focus:ring-accent/15 disabled:bg-zinc-50 disabled:text-zinc-500 sm:text-sm";

export function Field({ label, hint, children, className }: { label?: ReactNode; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={cx("block min-w-0", className)}>
      {label && <span className="mb-1.5 block text-[13px] font-medium text-zinc-700">{label}</span>}
      {children}
      {hint && <span className="mt-1.5 block text-xs leading-relaxed text-zinc-500">{hint}</span>}
    </label>
  );
}

export function Input({ className, ...rest }: ComponentProps<"input">) {
  const isBox = rest.type === "checkbox" || rest.type === "radio";
  return <input {...rest} className={cx(isBox ? "h-4 w-4" : cx(inputBase, rest.type === "color" ? "h-9 p-1" : "h-9 py-1.5"), className)} />;
}

export function Textarea({ className, ...rest }: ComponentProps<"textarea">) {
  return <textarea rows={3} {...rest} className={cx(inputBase, "py-2", className)} />;
}

export function Select({ className, children, ...rest }: ComponentProps<"select">) {
  return (
    <select {...rest} className={cx(inputBase, "h-9 appearance-none bg-[length:16px] bg-[right_8px_center] bg-no-repeat pr-8", "bg-[url(\"data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' fill='none' stroke='%2371717a' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'%3E%3Cpath d='m6 9 6 6 6-6'/%3E%3C/svg%3E\")]", className)}>
      {children}
    </select>
  );
}

export function Checkbox({ label, ...rest }: ComponentProps<"input"> & { label: ReactNode }) {
  return (
    <label className="flex cursor-pointer items-start gap-2.5 text-sm text-zinc-700">
      <input type="checkbox" {...rest} className="mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-300 accent-[rgb(var(--accent))]" />
      <span>{label}</span>
    </label>
  );
}

export function FormGrid({ children, cols = 2 }: { children: ReactNode; cols?: 1 | 2 | 3 | 4 }) {
  const c = { 1: "sm:grid-cols-1", 2: "sm:grid-cols-2", 3: "sm:grid-cols-3", 4: "sm:grid-cols-2 lg:grid-cols-4" }[cols];
  return <div className={cx("grid grid-cols-1 gap-x-4 gap-y-4", c)}>{children}</div>;
}
