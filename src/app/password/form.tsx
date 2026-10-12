"use client";

import { useActionState } from "react";
import { changePasswordAction } from "./actions";
import { inputClass } from "../login/form";

export function PasswordForm({ forced, labels }: { forced: boolean; labels: { current: string; password: string; repeat: string; submit: string } }) {
  const [state, action, pending] = useActionState(changePasswordAction, null);
  return (
    <form action={action} className="space-y-4">
      {!forced && (
        <label className="block">
          <span className="mb-1.5 block text-[13px] font-medium text-zinc-700">{labels.current}</span>
          <input name="current" type="password" autoComplete="current-password" required className={inputClass} />
        </label>
      )}
      <label className="block">
        <span className="mb-1.5 block text-[13px] font-medium text-zinc-700">{labels.password}</span>
        <input name="password" type="password" autoComplete="new-password" minLength={8} required className={inputClass} />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[13px] font-medium text-zinc-700">{labels.repeat}</span>
        <input name="password2" type="password" autoComplete="new-password" minLength={8} required className={inputClass} />
      </label>
      {state?.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{state.error}</p>}
      <button type="submit" disabled={pending} className="h-11 w-full rounded-lg bg-zinc-900 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-60">
        {pending ? "…" : labels.submit}
      </button>
    </form>
  );
}
