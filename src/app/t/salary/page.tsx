import { requireCtx } from "@/lib/ctx";
import { db } from "@/lib/db";
import { todayISO } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { liveSalary } from "@/lib/salary/service";
import type { SalaryResult } from "@/lib/salary/engine";
import { SalaryBreakdown } from "@/components/salary-view";
import { Badge } from "@/components/ui";

export default async function TeacherSalary() {
  const ctx = await requireCtx();
  const { t } = ctx;
  const month = todayISO().slice(0, 7);
  const [{ result, lessons }, last] = await Promise.all([
    liveSalary(ctx.centerId, ctx.userId, month),
    db.payslip.findFirst({ where: { teacherId: ctx.userId, status: { not: "DRAFT" } }, orderBy: { month: "desc" } }),
  ]);
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">{t("salary.myTitle")}</h1>
      <div className="rounded-xl bg-white p-4 shadow-sm">
        <div className="text-xs uppercase text-zinc-500">{t("t.salarySoFar")} ({month})</div>
        <div className="text-2xl font-semibold">{formatMoney(result.total)}</div>
      </div>
      {last && (
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between text-xs uppercase text-zinc-500">{t("t.lastPayslip")} · {last.month} <Badge tone={last.status === "PAID" ? "green" : "blue"}>{t(`payslip.${last.status}`)}</Badge></div>
          <div className="text-xl font-semibold">{formatMoney(last.total)}</div>
          <div className="mt-2 text-xs text-zinc-500">{(last.lines as unknown as SalaryResult).lines?.map((l) => `${l.groupName}: ${formatMoney(l.amount)}`).join(" · ")}</div>
        </div>
      )}
      <SalaryBreakdown ctx={ctx} result={result} lessons={lessons} />
    </div>
  );
}
