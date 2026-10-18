import { notFound } from "next/navigation";
import { canAccessBranch, requireStaff } from "@/lib/ctx";
import { db } from "@/lib/db";
import { isMonth, monthLabel, todayISO } from "@/lib/dates";
import { boardRows, defaultReportMonth } from "@/lib/services/report-cards";
import { PageHeader } from "@/components/ui";
import { MonthPicker, ReportCardsBoard } from "@/components/report-cards-board";

export default async function GroupReportCards({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ month?: string }> }) {
  const { id } = await params;
  const sp = await searchParams;
  const ctx = await requireStaff();
  const { t } = ctx;
  const group = await db.group.findFirst({ where: { id, centerId: ctx.centerId }, select: { id: true, name: true, code: true, branchId: true } });
  if (!group || !canAccessBranch(ctx, group.branchId)) notFound();
  const month = isMonth(sp.month) ? sp.month : defaultReportMonth(todayISO());
  const rows = await boardRows(ctx.centerId, id, month);
  return (
    <>
      <PageHeader back={{ href: `/groups/${id}`, label: `${group.name} #${group.code}` }} title={t("rc.title")} subtitle={monthLabel(month, ctx.locale)} />
      <MonthPicker month={month} label={t("rc.title")} filter={t("common.filter")} />
      <ReportCardsBoard rows={rows} groupId={id} month={month} canSend={ctx.can("groups.edit")} t={t} />
    </>
  );
}
