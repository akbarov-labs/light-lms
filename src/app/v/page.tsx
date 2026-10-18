import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { makeT } from "@/lib/i18n";
import { normalizeCode } from "@/lib/academics/exams";

export const metadata: Metadata = { title: "Sertifikat / Сертификат" };

/** Public: type the code printed on a certificate. */
export default async function VerifyForm({ searchParams }: { searchParams: Promise<{ code?: string; lang?: string }> }) {
  const sp = await searchParams;
  const locale = sp.lang === "ru" ? "ru" : "uz";
  const t = makeT(locale);
  const code = sp.code ? normalizeCode(sp.code) : null;
  if (code) redirect(`/v/${code}${sp.lang ? `?lang=${locale}` : ""}`);
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <form className="w-full max-w-sm space-y-3 rounded-xl border border-zinc-200 bg-white p-6 shadow-xs">
        <h1 className="text-lg font-semibold">{t("cert.checkTitle")}</h1>
        <label htmlFor="code" className="block text-sm text-zinc-600">{t("cert.checkPrompt")}</label>
        <input id="code" name="code" defaultValue={sp.code ?? ""} autoCapitalize="characters" autoComplete="off" className="block h-11 w-full rounded-lg border border-zinc-300 px-3 font-mono text-lg uppercase tracking-widest" required />
        {sp.code && !code && <p className="text-sm text-red-700" role="alert">{t("cert.notFound")}</p>}
        {sp.lang && <input type="hidden" name="lang" value={locale} />}
        <button className="h-11 w-full rounded-lg bg-zinc-900 font-medium text-white hover:bg-zinc-800">{t("cert.check")}</button>
      </form>
    </main>
  );
}
