"use client";

import { useActionState } from "react";
import { loginAction } from "./actions";

export function LoginForm({ labels, next }: { labels: { phone: string; password: string; submit: string }; next?: string }) {
  const [state, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <label className="block">
        <span className="mb-1.5 block text-[13px] font-medium text-zinc-700">{labels.phone}</span>
        <input name="phone" type="tel" inputMode="tel" autoComplete="username" required placeholder="90 123 45 67" className="block h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-base hover:border-zinc-300 focus:border-zinc-900 focus:outline-none focus:ring-[3px] focus:ring-zinc-900/10" />
      </label>
      <label className="block">
        <span className="mb-1.5 block text-[13px] font-medium text-zinc-700">{labels.password}</span>
        <input name="password" type="password" autoComplete="current-password" required className="block h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-base hover:border-zinc-300 focus:border-zinc-900 focus:outline-none focus:ring-[3px] focus:ring-zinc-900/10" />
      </label>
      {state?.error && <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{state.error}</p>}
      <button type="submit" disabled={pending} className="h-11 w-full rounded-lg bg-zinc-900 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-60">
        {pending ? "…" : labels.submit}
      </button>
    </form>
  );
}
