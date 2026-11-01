import { ChevronLeft, ChevronRight } from "lucide-react";
import Link from "next/link";
import { requireStaff } from "@/lib/ctx";
import { db } from "@/lib/db";
import { monthParam, shiftMonth } from "@/lib/dates";
import { monthLabel } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { liveSalary, ruleFor } from "@/lib/salary/service";
import { Badge, Card, LinkButton, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { teacherWhere } from "@/lib/queries/staff";

export default async function SalaryPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireStaff("finance.view");
  const { t } = ctx;
  const month = monthParam(sp.month);
  const teachers = await db.user.findMany({
    where: { centerId: ctx.centerId, ...teacherWhere, ...(ctx.branchIds ? { branches: { some: { branchId: { in: ctx.branchIds } } } } : {}) },
    orderBy: [{ archivedAt: "asc" }, { name: "asc" }],
  });
  const all = await Promise.all(
    teachers.map(async (u) => {
      const [{ result }, rule, slip] = await Promise.all([liveSalary(ctx.centerId, u.id, month), ruleFor(u.id, month), db.payslip.findUnique({ where: { teacherId_month: { teacherId: u.id, month } } })]);
      return { u, result, rule, slip };
    }),
  );
  // an archived teacher with nothing to pay this month (no lessons, no base after leaving) is noise
  const rows = all.filter((r) => !r.u.archivedAt || r.slip || r.result.total !== 0 || r.result.lessonsHeld > 0);
  const total = rows.reduce((s, r) => s + (r.slip && r.slip.status !== "DRAFT" ? r.slip.total : r.result.total), 0);
  return (
    <>
      <PageHeader
        title={t("nav.salary")}
        subtitle={`${monthLabel(month, ctx.locale)} · ${t("common.total")}: ${formatMoney(total)}`}
        actions={
          <>
            <LinkButton variant="secondary" href={`/salary?month=${shiftMonth(month, -1)}`} aria-label={monthLabel(shiftMonth(month, -1), ctx.locale)}><ChevronLeft className="h-3.5 w-3.5" aria-hidden />{monthLabel(shiftMonth(month, -1), ctx.locale)}</LinkButton>
            <LinkButton variant="secondary" href={`/salary?month=${shiftMonth(month, 1)}`} aria-label={monthLabel(shiftMonth(month, 1), ctx.locale)}>{monthLabel(shiftMonth(month, 1), ctx.locale)}<ChevronRight className="h-3.5 w-3.5" aria-hidden /></LinkButton>
            {ctx.can("export") && <LinkButton variant="secondary" href={`/api/export/salary?month=${month}`}>{t("common.export")}</LinkButton>}
          </>
        }
      />
      <Card pad={false}>
        <Table>
          <thead><tr><Th>{t("common.teacher")}</Th><Th>{t("salary.model")}</Th><Th className="text-right">{t("salary.lessonsHeld")}</Th><Th className="text-right">{t("salary.live")}</Th><Th>{t("common.status")}</Th><Th className="text-right">{t("salary.lockedTotal")}</Th></tr></thead>
          <tbody>
            {rows.map(({ u, result, rule, slip }) => (
              <Tr key={u.id} muted={!!u.archivedAt}>
                <Td><Link href={`/salary/${u.id}?month=${month}`} className="font-medium text-zinc-900 hover:underline hover:decoration-zinc-400">{u.name}</Link>{u.archivedAt && <> <Badge>{t("settings.archived")}</Badge></>}</Td>
                <Td className="text-xs">{rule ? `${t(`salary.${rule.model}`)}${rule.percent ? ` · ${rule.percent}%` : ""}` : <Link href={`/salary/${u.id}?month=${month}&rule=new`} className="text-amber-700 underline decoration-amber-300 underline-offset-2 hover:decoration-amber-700">{t("salary.noRule")} · {t("salary.setRule")}</Link>}</Td>
                <Td className="text-right">{result.lessonsHeld}</Td>
                <Td className="whitespace-nowrap text-right font-medium">{formatMoney(result.total)}</Td>
                <Td><Badge tone={slip?.status === "PAID" ? "green" : slip?.status === "LOCKED" ? "blue" : "gray"}>{t(`payslip.${slip?.status ?? "DRAFT"}`)}</Badge></Td>
                <Td className="whitespace-nowrap text-right">{slip && slip.status !== "DRAFT" ? formatMoney(slip.total) : "—"}{slip && slip.status !== "DRAFT" && slip.total !== result.total && <div className="text-xs text-amber-700">≠ {formatMoney(result.total)}</div>}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
