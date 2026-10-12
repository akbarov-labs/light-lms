"use client";

import { useActionState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { signupAction } from "./actions";

type Labels = Record<
  "centerName" | "centerNamePh" | "ownerName" | "phone" | "phoneHint" | "password" | "passwordHint" | "language" | "submit",
  string
>;

const input =
  "block h-11 w-full rounded-lg border border-zinc-200 bg-white px-3 text-base text-zinc-900 hover:border-zinc-300 focus:border-zinc-900 focus:outline-none focus:ring-[3px] focus:ring-zinc-900/10";
const label = "mb-1.5 block text-[13px] font-medium text-zinc-700";
const hint = "mt-1.5 block text-xs text-zinc-500";

/** "I agree with {offer} and {privacy}" with both names linked to the legal pages (opened in a new tab). */
function ConsentText({ c }: { c: Consent }) {
  const link = (href: string, label: string) => (
    <a href={href} target="_blank" rel="noopener" className="font-medium text-zinc-900 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-900">
      {label}
    </a>
  );
  return (
    <>
      {c.text.split(/(\{offer\}|\{privacy\})/).map((part, i) =>
        part === "{offer}" ? <span key={i}>{link("/legal/offer", c.offer)}</span> : part === "{privacy}" ? <span key={i}>{link("/legal/privacy", c.privacy)}</span> : part,
      )}
    </>
  );
}

type Consent = { text: string; offer: string; privacy: string };

export function SignupForm({ labels, locale, startedAt, consent }: { labels: Labels; locale: "uz" | "ru"; startedAt: number; consent: Consent }) {
  const [state, action, pending] = useActionState(signupAction, null);
  const v = state?.values;
  return (
    // re-keyed after each failed attempt so the fields come back with what was typed
    <form key={state?.at ?? 0} action={action} className="space-y-4">
      <input type="hidden" name="startedAt" value={startedAt} />
      {/* honeypot: people never see or fill this */}
      <div aria-hidden className="absolute -left-[9999px] h-px w-px overflow-hidden">
        <label>
          Website
          <input name="website" type="text" tabIndex={-1} autoComplete="off" defaultValue="" />
        </label>
      </div>
      <label className="block">
        <span className={label}>{labels.centerName}</span>
        <input name="centerName" defaultValue={v?.centerName} required maxLength={120} autoComplete="organization" placeholder={labels.centerNamePh} className={input} />
      </label>
      <label className="block">
        <span className={label}>{labels.ownerName}</span>
        <input name="ownerName" defaultValue={v?.ownerName} required maxLength={120} autoComplete="name" className={input} />
      </label>
      <label className="block">
        <span className={label}>{labels.phone}</span>
        <input name="phone" defaultValue={v?.phone} type="tel" inputMode="tel" autoComplete="tel" required placeholder="90 123 45 67" className={input} />
        <span className={hint}>{labels.phoneHint}</span>
      </label>
      <label className="block">
        <span className={label}>{labels.password}</span>
        <input name="password" type="password" autoComplete="new-password" required minLength={8} className={input} />
        <span className={hint}>{labels.passwordHint}</span>
      </label>
      <fieldset>
        <legend className={label}>{labels.language}</legend>
        <div className="grid grid-cols-2 gap-1 rounded-lg bg-zinc-100 p-1">
          {(["uz", "ru"] as const).map((l) => (
            <label key={l} className="relative">
              <input type="radio" name="locale" value={l} defaultChecked={l === (v?.locale ?? locale)} className="peer sr-only" />
              <span className="flex h-9 cursor-pointer items-center justify-center rounded-md text-sm text-zinc-600 transition-colors hover:text-zinc-900 peer-checked:bg-white peer-checked:font-medium peer-checked:text-zinc-900 peer-checked:shadow-sm peer-focus-visible:ring-2 peer-focus-visible:ring-zinc-900/20">
                {l === "uz" ? "O'zbekcha" : "Русский"}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      <label className="flex cursor-pointer items-start gap-2.5 text-sm leading-snug text-zinc-600">
        <input type="checkbox" name="consent" required className="mt-0.5 h-4 w-4 shrink-0 rounded border-zinc-300 accent-zinc-900" />
        <span><ConsentText c={consent} /></span>
      </label>
      {state?.error && (
        <p className="flex items-start gap-2 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          {state.error}
        </p>
      )}
      <button type="submit" disabled={pending} aria-busy={pending} className="inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-zinc-900 text-sm font-medium text-white transition-colors hover:bg-zinc-800 disabled:opacity-60">
        {pending && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
        {labels.submit}
      </button>
    </form>
  );
}
