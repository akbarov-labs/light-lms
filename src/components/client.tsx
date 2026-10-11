"use client";

import { createContext, useActionState, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useRouter } from "next/navigation";
import { buttonClass, cx, type ButtonVariant } from "./ui";

type ActionState = { ok?: boolean; error?: string; message?: string; at?: number } | null;
type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/** A form bound to a server action; shows its error / success message inline. */
export function ActionForm({
  action,
  children,
  className,
  reset = false,
  onDone,
  success,
}: {
  action: Action;
  children: ReactNode;
  className?: string;
  reset?: boolean;
  onDone?: () => void;
  success?: string;
}) {
  const [state, formAction] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) {
      if (reset) ref.current?.reset();
      onDone?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state?.at]);
  return (
    <form ref={ref} action={formAction} className={className}>
      {children}
      {state?.error && <p className="mt-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{state.error}</p>}
      {state?.ok && (state.message || success) && <p className="mt-2 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-700">{state.message || success}</p>}
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
      className={cx(buttonClass(variant, size), className)}
      onClick={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {pending ? "…" : children}
    </button>
  );
}

const ModalCtx = createContext<() => void>(() => {});

/** Button that opens a native <dialog>. Content is mounted only while open. */
export function Modal({ label, title, children, variant = "primary", size = "md", wide }: { label: ReactNode; title: ReactNode; children: ReactNode; variant?: ButtonVariant; size?: "sm" | "md"; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [open, setOpen] = useState(false);
  const close = () => {
    ref.current?.close();
    setOpen(false);
  };
  return (
    <>
      <button type="button" className={buttonClass(variant, size)} onClick={() => { setOpen(true); ref.current?.showModal(); }}>
        {label}
      </button>
      <dialog ref={ref} onClose={() => setOpen(false)} className={cx("w-[calc(100%-2rem)] rounded-xl p-0 text-left shadow-xl backdrop:bg-slate-900/40", wide ? "max-w-3xl" : "max-w-lg")}>
        <div className="flex items-center justify-between border-b border-slate-100 px-4 py-3">
          <h3 className="text-base font-semibold text-slate-900">{title}</h3>
          <button type="button" onClick={close} className="rounded p-1 text-slate-400 hover:bg-slate-100 hover:text-slate-700" aria-label="close">✕</button>
        </div>
        <div className="max-h-[75vh] overflow-y-auto p-4">{open ? <ModalCtx.Provider value={close}>{children}</ModalCtx.Provider> : null}</div>
      </dialog>
    </>
  );
}

/** ActionForm that closes the surrounding Modal and refreshes the page on success. */
export function ModalForm({ action, children, className }: { action: Action; children: ReactNode; className?: string }) {
  const router = useRouter();
  const close = useContext(ModalCtx);
  return (
    <ActionForm action={action} className={className} onDone={() => { close(); router.refresh(); }}>
      {children}
    </ActionForm>
  );
}

/** Auto-submits its form when a select changes (filters, branch switcher). */
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

export function MobileNavToggle({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="rounded-lg p-2 text-slate-600 hover:bg-slate-100 lg:hidden" onClick={() => setOpen((o) => !o)} aria-label="menu">
        ☰
      </button>
      {open && (
        <div className="fixed inset-0 z-40 lg:hidden" onClick={() => setOpen(false)}>
          <div className="absolute inset-0 bg-slate-900/30" />
          <div className="absolute inset-y-0 left-0 w-64 overflow-y-auto bg-white shadow-xl">{children}</div>
        </div>
      )}
    </>
  );
}
