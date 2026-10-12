"use client";

import { useActionState, useState } from "react";
import { loginAction, requestCodeAction, resetPasswordAction } from "./actions";

export const inputClass =
  "block h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-base hover:border-zinc-300 focus:border-zinc-900 focus:outline-none focus:ring-[3px] focus:ring-zinc-900/10";
const buttonClass = "h-11 w-full rounded-lg bg-zinc-900 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-60";

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-[13px] font-medium text-zinc-700">{label}</span>
      {children}
    </label>
  );
}

function ErrorText({ text }: { text?: string }) {
  return text ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">{text}</p> : null;
}

export function LoginForm({ labels, next }: { labels: { phone: string; password: string; submit: string }; next?: string }) {
  const [state, action, pending] = useActionState(loginAction, null);
  return (
    <form action={action} className="space-y-4">
      <input type="hidden" name="next" value={next ?? ""} />
      <Field label={labels.phone}>
        {/* keyed so the typed phone survives React's form reset after a failed attempt */}
        <input key={state?.at ?? 0} name="phone" type="tel" inputMode="tel" autoComplete="username" required placeholder="90 123 45 67" defaultValue={state?.phone} className={inputClass} />
      </Field>
      <Field label={labels.password}>
        <input name="password" type="password" autoComplete="current-password" required className={inputClass} />
      </Field>
      <ErrorText text={state?.error} />
      <button type="submit" disabled={pending} className={buttonClass}>
        {pending ? "…" : labels.submit}
      </button>
    </form>
  );
}

export interface ResetLabels {
  intro: string;
  phone: string;
  sendCode: string;
  code: string;
  newPassword: string;
  repeatPassword: string;
  setPassword: string;
  haveCode: string;
}

/** Forgot password: phone → code from the Telegram bot → new password. */
export function ResetForm({ labels }: { labels: ResetLabels }) {
  const [sent, requestAction, requesting] = useActionState(requestCodeAction, null);
  const [state, resetAction, resetting] = useActionState(resetPasswordAction, null);
  // "I have a code" (sent with /parol in the bot) skips step 1
  const [haveCode, setHaveCode] = useState(false);
  const phone = sent?.phone;
  if (!sent?.message && !haveCode) {
    return (
      <form action={requestAction} className="space-y-4">
        <p className="text-sm text-zinc-600">{labels.intro}</p>
        <Field label={labels.phone}>
          <input name="phone" type="tel" inputMode="tel" autoComplete="username" required placeholder="90 123 45 67" className={inputClass} />
        </Field>
        <ErrorText text={sent?.error} />
        <button type="submit" disabled={requesting} className={buttonClass}>{requesting ? "…" : labels.sendCode}</button>
        <button type="button" onClick={() => setHaveCode(true)} className="h-10 w-full rounded-lg text-sm text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900">{labels.haveCode}</button>
      </form>
    );
  }
  return (
    <form action={resetAction} className="space-y-4">
      {sent?.message && <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">{sent.message}</p>}
      {phone ? (
        <input type="hidden" name="phone" value={phone} />
      ) : (
        <Field label={labels.phone}>
          <input name="phone" type="tel" inputMode="tel" autoComplete="username" required placeholder="90 123 45 67" className={inputClass} />
        </Field>
      )}
      <Field label={labels.code}>
        <input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} required className={`${inputClass} tracking-[0.3em]`} />
      </Field>
      <Field label={labels.newPassword}>
        <input name="password" type="password" autoComplete="new-password" minLength={8} required className={inputClass} />
      </Field>
      <Field label={labels.repeatPassword}>
        <input name="password2" type="password" autoComplete="new-password" minLength={8} required className={inputClass} />
      </Field>
      <ErrorText text={state?.error} />
      <button type="submit" disabled={resetting} className={buttonClass}>{resetting ? "…" : labels.setPassword}</button>
    </form>
  );
}
