"use client";

import { useActionState } from "react";
import { loginAction } from "./actions";
import { buttonClass } from "@/components/ui";

export function LoginForm({ labels, next }: { labels: { phone: string; password: string; submit: string }; next?: string }) {
  const [state, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">{labels.phone}</span>
        <input name="phone" type="tel" inputMode="tel" autoComplete="username" required placeholder="90 123 45 67" className="block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20" />
      </label>
      <label className="block">
        <span className="mb-1 block text-sm font-medium text-slate-700">{labels.password}</span>
        <input name="password" type="password" autoComplete="current-password" required className="block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20" />
      </label>
      {state?.error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700" role="alert">{state.error}</p>}
      <button type="submit" disabled={pending} className={buttonClass("primary") + " w-full py-2.5"}>
        {pending ? "…" : labels.submit}
      </button>
    </form>
  );
}
