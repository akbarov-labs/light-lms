import Link from "next/link";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { makeT } from "@/lib/i18n";
import { formatDate, formatDateTime, toISODate } from "@/lib/dates";
import { normalizeCode } from "@/lib/academics/exams";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Public verification behind the QR code: is this certificate real, and is it still valid? */
export default async function VerifyCertificate({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ lang?: string }> }) {
  const { code: raw } = await params;
  const sp = await searchParams;
  const code = normalizeCode(decodeURIComponent(raw));
  const c = code ? await db.certificate.findUnique({ where: { code }, include: { student: { select: { firstName: true, lastName: true } }, center: { select: { name: true, locale: true, disabledAt: true } } } }) : null;
  const locale = sp.lang === "ru" || sp.lang === "uz" ? sp.lang : c?.center.locale === "ru" ? "ru" : "uz";
  const t = makeT(locale);
  const found = c && !c.center.disabledAt;
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-xl border border-zinc-200 bg-white p-6 shadow-xs">
        <div className="mb-4 flex justify-between text-sm">
          <h1 className="font-semibold">{t("cert.checkTitle")}</h1>
          <span className="space-x-3"><a href="?lang=uz" className={locale === "uz" ? "font-semibold" : "text-zinc-500"}>UZ</a><a href="?lang=ru" className={locale === "ru" ? "font-semibold" : "text-zinc-500"}>RU</a></span>
        </div>
        {!found ? (
          <>
            <p className="rounded-lg bg-red-50 px-3 py-3 text-sm text-red-800" role="alert">{t("cert.notFound")}</p>
            <Link href="/v" className="mt-4 inline-block text-sm text-zinc-600 underline underline-offset-4">{t("cert.check")}</Link>
          </>
        ) : (
          <>
            <p className={`rounded-lg px-3 py-3 text-center text-base font-semibold ${c.revokedAt ? "bg-red-50 text-red-800" : "bg-emerald-50 text-emerald-800"}`} role="status">
              {c.revokedAt ? `✕ ${t("cert.revoked")} · ${t("cert.revokedOn", { date: formatDateTime(c.revokedAt).slice(0, 10) })}` : `✓ ${t("cert.valid")}`}
            </p>
            <dl className="mt-4 space-y-2 text-sm">
              {([
                [t("cert.issuedTo"), `${c.student.lastName} ${c.student.firstName}`],
                [t("cert.courseTitle"), c.title],
                ...(c.level ? [[t("cert.level"), c.level]] : []),
                ...(c.score !== null ? [[t("cert.score"), `${c.score}${c.maxScore ? ` / ${c.maxScore}` : ""}`]] : []),
                [t("cert.number"), c.number],
                [t("cert.issuedAt"), formatDate(toISODate(c.issuedAt))],
                [t("cert.issuedBy"), c.center.name],
              ] as [string, string][]).map(([k, v]) => (
                <div key={k} className="flex justify-between gap-4"><dt className="text-zinc-500">{k}</dt><dd className="text-right font-medium">{v}</dd></div>
              ))}
            </dl>
          </>
        )}
      </div>
    </main>
  );
}
