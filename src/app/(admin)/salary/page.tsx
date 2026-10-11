import Link from "next/link";
import { requireStaff } from "@/lib/ctx";
import { db } from "@/lib/db";
import { shiftMonth, todayISO } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { liveSalary, ruleFor } from "@/lib/salary/service";
import { Badge, Card, LinkButton, PageHeader, Table, Td, Th, Tr } from "@/components/ui";

export default async function SalaryPage({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireStaff("finance.view");
  const { t } = ctx;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : todayISO().slice(0, 7);
  const teachers = await db.user.findMany({
    where: { centerId: ctx.centerId, OR: [{ isTeacher: true }, { role: "TEACHER" }], ...(ctx.branchIds ? { branches: { some: { branchId: { in: ctx.branchIds } } } } : {}) },
    orderBy: [{ archivedAt: "asc" }, { name: "asc" }],
  });
  const rows = await Promise.all(
    teachers.map(async (u) => {
      const [{ result }, rule, slip] = await Promise.all([liveSalary(ctx.centerId, u.id, month), ruleFor(u.id, month), db.payslip.findUnique({ where: { teacherId_month: { teacherId: u.id, month } } })]);
      return { u, result, rule, slip };
    }),
  );
  const total = rows.reduce((s, r) => s + (r.slip && r.slip.status !== "DRAFT" ? r.slip.total : r.result.total), 0);
  return (
    <>
      <PageHeader
        title={t("nav.salary")}
        subtitle={`${month} · ${t("common.total")}: ${formatMoney(total)}`}
        actions={
          <>
            <LinkButton variant="secondary" href={`/salary?month=${shiftMonth(month, -1)}`}>← {shiftMonth(month, -1)}</LinkButton>
            <LinkButton variant="secondary" href={`/salary?month=${shiftMonth(month, 1)}`}>{shiftMonth(month, 1)} →</LinkButton>
            {ctx.can("export") && <LinkButton variant="secondary" href={`/api/export/salary?month=${month}`}>{t("common.export")}</LinkButton>}
          </>
        }
      />
      <Card pad={false}>
        <Table>
          <thead><tr><Th>{t("common.teacher")}</Th><Th>{t("salary.model")}</Th><Th className="text-right">{t("salary.lessonsHeld")}</Th><Th className="text-right">{t("salary.live")}</Th><Th>{t("common.status")}</Th><Th className="text-right">{t("salary.lockedTotal")}</Th></tr></thead>
          <tbody>
            {rows.map(({ u, result, rule, slip }) => (
              <Tr key={u.id} className={u.archivedAt ? "opacity-50" : ""}>
                <Td><Link href={`/salary/${u.id}?month=${month}`} className="font-medium text-slate-900 hover:text-accent">{u.name}</Link></Td>
                <Td className="text-xs">{rule ? `${t(`salary.${rule.model}`)}${rule.percent ? ` · ${rule.percent}%` : ""}` : <span className="text-amber-700">{t("salary.noRule")}</span>}</Td>
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
