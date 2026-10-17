"use client";

import { createContext, useActionState, useContext, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { CheckCircle2, MoreHorizontal, X, AlertCircle, Loader2 } from "lucide-react";
import { buttonClass, cx, type ButtonVariant } from "./ui";
import { typedMoney } from "@/lib/money";

type ActionState = { ok?: boolean; error?: string; message?: string; at?: number } | null;
type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

// ------------------------------------------------------------------ toasts

type ToastItem = { id: number; text: string; tone: "ok" | "error" };
const TOAST_EVENT = "lms:toast";

/** Show a toast from anywhere on the client. */
export function toast(text: string, tone: "ok" | "error" = "ok") {
  window.dispatchEvent(new CustomEvent(TOAST_EVENT, { detail: { text, tone } }));
}

/** Toast stack, mounted once by the shell (bottom-right on desktop, bottom on phones). */
export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  useEffect(() => {
    let n = 0;
    const onToast = (e: Event) => {
      const d = (e as CustomEvent<{ text: string; tone: "ok" | "error" }>).detail;
      const id = ++n;
      setItems((x) => [...x.slice(-2), { id, ...d }]);
      setTimeout(() => setItems((x) => x.filter((i) => i.id !== id)), d.tone === "error" ? 6000 : 3500);
    };
    window.addEventListener(TOAST_EVENT, onToast);
    return () => window.removeEventListener(TOAST_EVENT, onToast);
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-60 flex flex-col items-center gap-2 px-4 sm:inset-x-auto sm:right-4 sm:items-end" role="status" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className="pointer-events-auto flex max-w-sm animate-toast-in items-start gap-2.5 rounded-xl bg-zinc-900 px-3.5 py-2.5 text-sm text-white shadow-pop">
          {t.tone === "ok" ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-400" aria-hidden /> : <AlertCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" aria-hidden />}
          <span className="whitespace-pre-line">{t.text}</span>
        </div>
      ))}
    </div>
  );
}

const SavedLabel = createContext("OK");
export function SavedLabelProvider({ value, children }: { value: string; children: ReactNode }) {
  return <SavedLabel.Provider value={value}>{children}</SavedLabel.Provider>;
}

// ------------------------------------------------------------------ forms

/** A form bound to a server action. Errors show inline; success confirms with a toast. */
export function ActionForm({
  action,
  children,
  className,
  reset = false,
  onDone,
  success,
  quiet = false,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  reset?: boolean;
  onDone?: () => void;
  success?: string;
  /** keep long result messages inline instead of a toast (imports, reports) */
  quiet?: boolean;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  const saved = useContext(SavedLabel);
  useEffect(() => {
    if (!state?.at) return;
    if (state.ok) {
      if (reset) ref.current?.reset();
      if (!quiet) toast(state.message || success || saved);
      onDone?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.at]);
  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      {state?.error && (
        <p className="mt-3 flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {state.error}
        </p>
      )}
      {quiet && state?.ok && state.message && <p className="mt-3 whitespace-pre-line rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{state.message}</p>}
    </form>
  );
}

export function SubmitButton({ children, variant = "primary", size = "md", confirm, name, value, className }: { children: ReactNode; variant?: ButtonVariant; size?: "sm" | "md"; confirm?: string; name?: string; value?: string; className?: string }) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      aria-busy={pending}
      className={cx(buttonClass(variant, size), className)}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending && <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />}
      {children}
    </button>
  );
}

// ------------------------------------------------------------------ dialogs

const ModalCtx = createContext<() => void>(() => {});

function useDialog() {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const show = () => {
    setOpen(true);
    ref.current?.showModal();
  };
  const close = () => {
    ref.current?.close();
    setOpen(false);
  };
  // move focus to the first field once the content mounts
  useEffect(() => {
    if (!open) return;
    const el = ref.current?.querySelector<HTMLElement>("[data-dialog-body] input:not([type=hidden]), [data-dialog-body] select, [data-dialog-body] textarea, [data-dialog-body] button");
    el?.focus();
  }, [open]);
  return { ref, open, show, close, setOpen };
}

function DialogShell({ d, title, wide, closeLabel, children }: { d: ReturnType<typeof useDialog>; title: ReactNode; wide?: boolean; closeLabel: string; children: ReactNode }) {
  const titleId = useId();
  return (
    <dialog
      ref={d.ref}
      aria-labelledby={titleId}
      onClose={() => d.setOpen(false)}
      onClick={(e) => {
        if (e.target === d.ref.current) d.close();
      }}
      className={cx("w-[calc(100%-2rem)] whitespace-normal rounded-2xl border border-line p-0 text-left text-zinc-900 shadow-pop", wide ? "max-w-2xl" : "max-w-md")}
    >
      <div className="flex items-center justify-between gap-3 px-5 pb-1 pt-4">
        <h3 id={titleId} className="text-base font-semibold tracking-[-0.01em]">{title}</h3>
        <button type="button" onClick={d.close} className="-mr-1.5 rounded-md p-1.5 text-zinc-400 transition-colors hover:bg-zinc-100 hover:text-zinc-700" aria-label={closeLabel}>
          <X className="h-4 w-4" aria-hidden />
        </button>
      </div>
      <div data-dialog-body className="max-h-[75vh] overflow-y-auto px-5 pb-5 pt-3">
        {d.open ? <ModalCtx.Provider value={d.close}>{children}</ModalCtx.Provider> : null}
      </div>
    </dialog>
  );
}

const CloseLabel = createContext("Yopish");
export function CloseLabelProvider({ value, children }: { value: string; children: ReactNode }) {
  return <CloseLabel.Provider value={value}>{children}</CloseLabel.Provider>;
}

/** Button that opens a native <dialog>. Content is mounted only while open. */
export function Modal({ label, title, children, variant = "primary", size = "md", wide, icon, ariaLabel }: { label: ReactNode; title: ReactNode; children: ReactNode; variant?: ButtonVariant; size?: "sm" | "md"; wide?: boolean; icon?: ReactNode; ariaLabel?: string }) {
  const d = useDialog();
  const closeLabel = useContext(CloseLabel);
  return (
    <>
      <button type="button" className={buttonClass(variant, size)} onClick={d.show} aria-label={ariaLabel} aria-haspopup="dialog">
        {icon}
        {label}
      </button>
      <DialogShell d={d} title={title} wide={wide} closeLabel={closeLabel}>
        {children}
      </DialogShell>
    </>
  );
}

/** ActionForm that closes the surrounding dialog and refreshes the page on success. */
export function ModalForm({ action, children, className, success }: { action: Action; children: ReactNode; className?: string; success?: string }) {
  const router = useRouter();
  const close = useContext(ModalCtx);
  return (
    <ActionForm action={action} className={className} success={success} onDone={() => { close(); router.refresh(); }}>
      {children}
    </ActionForm>
  );
}

export interface MenuItem {
  key: string;
  label: string;
  title?: string;
  danger?: boolean;
  wide?: boolean;
  /** navigate instead of opening a dialog */
  href?: string;
  content?: ReactNode;
}

/** "⋯" row menu: secondary actions live here, each opening its own dialog. */
export function ActionMenu({ items, label }: { items: MenuItem[]; label: string }) {
  const [menu, setMenu] = useState(false);
  const [active, setActive] = useState<MenuItem | null>(null);
  const d = useDialog();
  const closeLabel = useContext(CloseLabel);
  const wrap = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!menu) return;
    const off = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setMenu(false);
    };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setMenu(false);
    document.addEventListener("mousedown", off);
    document.addEventListener("keydown", esc);
    wrap.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    return () => {
      document.removeEventListener("mousedown", off);
      document.removeEventListener("keydown", esc);
    };
  }, [menu]);
  if (items.length === 0) return null;
  return (
    <div ref={wrap} className="relative inline-block">
      <button type="button" aria-label={label} aria-haspopup="menu" aria-expanded={menu} onClick={() => setMenu((m) => !m)} className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-zinc-500 transition-colors hover:bg-zinc-100 hover:text-zinc-900">
        <MoreHorizontal className="h-4 w-4" aria-hidden />
      </button>
      {menu && (
        <div
          role="menu"
          className="absolute right-0 top-9 z-30 min-w-[200px] animate-pop-in rounded-xl border border-line bg-white p-1 text-left shadow-pop"
          onKeyDown={(e) => {
            if (e.key !== "ArrowDown" && e.key !== "ArrowUp") return;
            e.preventDefault();
            const els = [...(wrap.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
            const i = els.indexOf(document.activeElement as HTMLElement);
            els[(i + (e.key === "ArrowDown" ? 1 : -1) + els.length) % els.length]?.focus();
          }}
        >
          {items.map((it) =>
            it.href ? (
              <a key={it.key} href={it.href} role="menuitem" className="flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm text-zinc-700 outline-hidden transition-colors hover:bg-zinc-100 focus:bg-zinc-100">
                {it.label}
              </a>
            ) : (
            <button
              key={it.key}
              type="button"
              role="menuitem"
              onClick={() => {
                setMenu(false);
                setActive(it);
                d.show();
              }}
              className={cx("flex w-full items-center rounded-lg px-2.5 py-2 text-left text-sm outline-hidden transition-colors focus:bg-zinc-100", it.danger ? "text-red-600 hover:bg-red-50" : "text-zinc-700 hover:bg-zinc-100")}
            >
              {it.label}
            </button>
            ),
          )}
        </div>
      )}
      <DialogShell d={d} title={active?.title ?? active?.label} wide={active?.wide} closeLabel={closeLabel}>
        {active?.content}
      </DialogShell>
    </div>
  );
}

// ------------------------------------------------------------------ inputs

/** Money input that groups digits while typing ("1 250 000"); submits the digits. */
export function MoneyInput({ name, defaultValue, required, autoFocus, className, onValue, placeholder = "0" }: { name: string; defaultValue?: number | string; required?: boolean; autoFocus?: boolean; className?: string; onValue?: (n: number) => void; placeholder?: string }) {
  // typedMoney keeps a decimal tail ("300 000,00") instead of gluing it onto the so'm (audit B1)
  const [val, setVal] = useState(typedMoney(String(defaultValue ?? "")).display);
  const parsed = typedMoney(val).value;
  const bad = val !== "" && parsed === null;
  useEffect(() => {
    onValue?.(parsed ?? 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [val]);
  return (
    <div className="relative">
      <input
        inputMode="decimal"
        autoComplete="off"
        required={required}
        autoFocus={autoFocus}
        value={val}
        placeholder={placeholder}
        aria-invalid={bad || undefined}
        onChange={(e) => setVal(typedMoney(e.target.value).display)}
        className={cx(
          "tnum block h-9 w-full rounded-lg border border-zinc-200 bg-white py-1.5 pl-3 pr-14 text-base text-zinc-900 transition-[border-color,box-shadow] hover:border-zinc-300 focus:border-accent focus:outline-hidden focus:ring-[3px] focus:ring-accent/15 sm:text-sm",
          bad && "border-red-400",
          className,
        )}
      />
      <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-sm text-zinc-500">so&apos;m</span>
      {/* the server parses the typed text with parseMoney and rejects a non-zero decimal tail */}
      <input type="hidden" name={name} value={val} />
    </div>
  );
}

/** Auto-submits its form when a select changes (branch switcher). */
export function AutoSubmitSelect(props: React.ComponentProps<"select">) {
  return <select {...props} onChange={(e) => e.currentTarget.form?.requestSubmit()} />;
}

export function PrintButton({ label }: { label: string }) {
  return (
    <button type="button" className={buttonClass("secondary")} onClick={() => window.print()}>
      {label}
    </button>
  );
}
