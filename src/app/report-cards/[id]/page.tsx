import { notFound } from "next/navigation";
import Link from "next/link";
import { canAccessBranch, requireCtx } from "@/lib/ctx";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { cardData, cardUrl } from "@/lib/services/report-cards";
import { ReportCardView } from "@/components/report-card-view";
import { PrintButton } from "@/components/client";
import { accentVars } from "@/lib/color";

export const dynamic = "force-dynamic";

/** Staff / teacher view of one card (print to A4). Drafts show live numbers. */
export default async function ReportCardPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const { t } = ctx;
  const card = await db.reportCard.findFirst({ where: { id, centerId: ctx.centerId }, include: { group: { select: { id: true, teacherId: true, branchId: true } } } });
  if (!card) notFound();
  const mayView = card.group.teacherId === ctx.userId || (ctx.role !== "TEACHER" && canAccessBranch(ctx, card.group.branchId));
  if (!mayView) notFound();
  const data = await cardData(card.id);
  const back = ctx.role === "TEACHER" ? `/t/reports/${card.groupId}?month=${card.month}` : `/groups/${card.groupId}/reports?month=${card.month}`;
  return (
    <main style={accentVars(ctx.center.accentColor) as React.CSSProperties} className="mx-auto max-w-3xl px-4 py-6 print:max-w-none print:p-0">
      <div className="mb-4 flex flex-wrap items-center gap-3 print:hidden">
        <Link href={back} className="text-sm text-zinc-500 hover:text-zinc-900">← {t("rc.title")}</Link>
        <PrintButton label={t("common.print")} />
        {card.status === "SENT" && (
          <span className="text-xs text-zinc-500">
            {t("rc.sentAt", { date: formatDateTime(card.sentAt) })} · <a href={cardUrl(card.token)} className="underline underline-offset-4">{cardUrl(card.token)}</a>
          </span>
        )}
      </div>
      <ReportCardView data={data} t={t} locale={ctx.locale} note={card.status === "DRAFT" ? t("rc.liveNote") : undefined} />
    </main>
  );
}
