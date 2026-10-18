import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { db } from "@/lib/db";
import { makeT } from "@/lib/i18n";
import { accentVars } from "@/lib/color";
import type { ReportCardData } from "@/lib/services/report-cards";
import { ReportCardView } from "@/components/report-card-view";
import { PrintButton } from "@/components/client";
import { DocTitle } from "@/components/doc-title";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { robots: { index: false, follow: false } };

/** Parents' page behind the Telegram/SMS link: a sent card's frozen snapshot. Drafts are never public. */
export default async function PublicReportCard({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ lang?: string }> }) {
  const { token } = await params;
  const sp = await searchParams;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) notFound();
  const card = await db.reportCard.findUnique({ where: { token }, include: { center: { select: { locale: true, accentColor: true, disabledAt: true } } } });
  if (!card || card.status !== "SENT" || !card.data || card.center.disabledAt) notFound();
  const locale = sp.lang === "ru" || sp.lang === "uz" ? sp.lang : card.center.locale === "ru" ? "ru" : "uz";
  const t = makeT(locale);
  return (
    <main style={accentVars(card.center.accentColor) as React.CSSProperties} className="mx-auto max-w-3xl px-4 py-6 print:max-w-none print:p-0">
      <div className="mb-4 flex items-center justify-end gap-3 text-sm print:hidden">
        <a href="?lang=uz" className={locale === "uz" ? "font-semibold" : "text-zinc-500"}>O&apos;zbekcha</a>
        <a href="?lang=ru" className={locale === "ru" ? "font-semibold" : "text-zinc-500"}>Русский</a>
        <PrintButton label={t("common.print")} />
      </div>
      <DocTitle title={`${t("rc.title")} · ${(card.data as unknown as ReportCardData).student}`} />
      <ReportCardView data={card.data as unknown as ReportCardData} t={t} locale={locale} />
    </main>
  );
}
