import { notFound } from "next/navigation";
import Link from "next/link";
import { requireCtx } from "@/lib/ctx";
import { db } from "@/lib/db";
import { isMonth, monthLabel, todayISO } from "@/lib/dates";
import { boardRows, defaultReportMonth } from "@/lib/services/report-cards";
import { MonthPicker, ReportCardsBoard } from "@/components/report-cards-board";

/** Teacher: write this month's comments for a group they lead (sending is done by the office). */
export default async function TeacherGroupReports({ params, searchParams }: { params: Promise<{ groupId: string }>; searchParams: Promise<{ month?: string }> }) {
  const { groupId } = await params;
  const sp = await searchParams;
  const ctx = await requireCtx();
  const { t } = ctx;
  const group = await db.group.findFirst({ where: { id: groupId, centerId: ctx.centerId, teacherId: ctx.userId }, select: { id: true, name: true, code: true } });
  if (!group) notFound();
  const month = isMonth(sp.month) ? sp.month : defaultReportMonth(todayISO());
  const rows = await boardRows(ctx.centerId, groupId, month);
  return (
    <div className="space-y-3">
      <Link href="/t/reports" className="text-sm text-zinc-500 hover:text-zinc-900">← {t("rc.cards")}</Link>
      <h1 className="text-lg font-semibold">{group.name} <span className="text-zinc-500">#{group.code}</span></h1>
      <p className="text-sm text-zinc-600">{t("rc.title")} · {monthLabel(month, ctx.locale)}</p>
      <MonthPicker month={month} label={t("rc.title")} filter={t("common.filter")} />
      <ReportCardsBoard rows={rows} groupId={groupId} month={month} canSend={ctx.can("groups.edit")} t={t} />
    </div>
  );
}
