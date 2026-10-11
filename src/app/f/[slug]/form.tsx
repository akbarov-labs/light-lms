"use client";

import { useActionState } from "react";
import { submitLeadAction } from "./actions";

const input = "block w-full rounded-lg border border-slate-300 px-3 py-2.5 text-base shadow-sm focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/20";

export function PublicLeadForm({ slug, lang, courses, utm, l }: { slug: string; lang: string; courses: { id: string; name: string }[]; utm: Record<string, string>; l: Record<"name" | "phone" | "course" | "comment" | "submit" | "thanks", string> }) {
  const [state, action, pending] = useActionState(submitLeadAction, null);
  if (state?.ok) return <p className="rounded-xl bg-emerald-50 p-6 text-center text-emerald-800">{l.thanks}</p>;
  return (
    <form action={action} className="space-y-3">
      <input type="hidden" name="slug" value={slug} />
      <input type="hidden" name="lang" value={lang} />
      {Object.entries(utm).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
      <input name="website" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
      <label className="block"><span className="mb-1 block text-sm text-slate-700">{l.name}</span><input name="name" required className={input} /></label>
      <label className="block"><span className="mb-1 block text-sm text-slate-700">{l.phone}</span><input name="phone" type="tel" inputMode="tel" required placeholder="90 123 45 67" className={input} /></label>
      {courses.length > 0 && (
        <label className="block">
          <span className="mb-1 block text-sm text-slate-700">{l.course}</span>
          <select name="courseId" className={input} defaultValue="">
            <option value="">—</option>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </label>
      )}
      <label className="block"><span className="mb-1 block text-sm text-slate-700">{l.comment}</span><textarea name="comment" rows={3} className={input} /></label>
      {state?.error && <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{state.error}</p>}
      <button disabled={pending} className="w-full rounded-lg bg-accent py-3 font-medium text-accent-fg disabled:opacity-60">{pending ? "…" : l.submit}</button>
    </form>
  );
}
