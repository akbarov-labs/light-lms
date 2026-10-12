import { ChevronLeft, ChevronRight } from "lucide-react";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/ctx";
import { db } from "@/lib/db";
import { formatDate, formatDateTime, monthRange, shiftMonth, toISODate, todayISO } from "@/lib/dates";
import { monthLabel } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { liveSalary } from "@/lib/salary/service";
import type { SalaryResult } from "@/lib/salary/engine";
import { Badge, Card, LinkButton, PageHeader, Stat, Table, Td, Th, Tr } from "@/components/ui";
import { Field, FormGrid, Input, Select } from "@/components/fields";
import { ActionForm, Modal, ModalForm, SubmitButton } from "@/components/client";
import { SalaryBreakdown } from "@/components/salary-view";
import { adjustmentAction, payslipAction, saveRuleAction } from "../actions";

export default async function TeacherSalaryPage({ params, searchParams }: { params: Promise<{ teacherId: string }>; searchParams: Promise<{ month?: string }> }) {
  const { teacherId } = await params;
  const sp = await searchParams;
  const ctx = await requireStaff("finance.view");
  const { t } = ctx;
  const month = /^\d{4}-\d{2}$/.test(sp.month ?? "") ? sp.month! : todayISO().slice(0, 7);
  const teacher = await db.user.findFirst({ where: { id: teacherId, centerId: ctx.centerId }, include: { branches: true } });
  if (!teacher || (ctx.branchIds && !teacher.branches.some((b) => ctx.branchIds!.includes(b.branchId)))) notFound();
  const [{ result, lessons }, rules, slip] = await Promise.all([
    liveSalary(ctx.centerId, teacherId, month),
    db.salaryRule.findMany({ where: { teacherId }, orderBy: [{ validFrom: "desc" }, { createdAt: "desc" }] }),
    db.payslip.findUnique({ where: { teacherId_month: { teacherId, month } } }),
  ]);
  const locked = slip && slip.status !== "DRAFT" ? (slip.lines as unknown as SalaryResult) : null;
  const hidden = (op: string) => (
    <>
      <input type="hidden" name="teacherId" value={teacherId} />
      <input type="hidden" name="month" value={month} />
      <input type="hidden" name="op" value={op} />
    </>
  );
  return (
    <>
      <PageHeader
        back={{ href: `/salary?month=${month}`, label: t("nav.salary") }}
        title={teacher.name}
        subtitle={<span className="flex items-center gap-2">{monthLabel(month, ctx.locale)} <Badge tone={slip?.status === "PAID" ? "green" : slip?.status === "LOCKED" ? "blue" : "gray"}>{t(`payslip.${slip?.status ?? "DRAFT"}`)}</Badge></span>}
        actions={
          <>
            <LinkButton variant="secondary" href={`/salary/${teacherId}?month=${shiftMonth(month, -1)}`} aria-label={monthLabel(shiftMonth(month, -1), ctx.locale)}><ChevronLeft className="h-3.5 w-3.5" aria-hidden />{monthLabel(shiftMonth(month, -1), ctx.locale)}</LinkButton>
            <LinkButton variant="secondary" href={`/salary/${teacherId}?month=${shiftMonth(month, 1)}`} aria-label={monthLabel(shiftMonth(month, 1), ctx.locale)}>{monthLabel(shiftMonth(month, 1), ctx.locale)}<ChevronRight className="h-3.5 w-3.5" aria-hidden /></LinkButton>
            {(!slip || slip.status === "DRAFT") && (
              <ActionForm action={payslipAction}>{hidden("lock")}<SubmitButton confirm={t("common.confirm")}>{t("salary.lock")}</SubmitButton></ActionForm>
            )}
            {slip?.status === "LOCKED" && (
              <>
                <ActionForm action={payslipAction}>{hidden("paid")}<SubmitButton confirm={`${t("salary.paidHint")} ${t("common.confirm")}`}>{t("salary.markPaid")}</SubmitButton></ActionForm>
                <ActionForm action={payslipAction}>{hidden("unlock")}<SubmitButton variant="ghost">{t("salary.unlock")}</SubmitButton></ActionForm>
              </>
            )}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label={t("salary.live")} value={formatMoney(result.total)} />
        {locked && <Stat label={t("salary.lockedTotal")} value={formatMoney(slip!.total)} hint={slip!.lockedAt ? formatDateTime(slip!.lockedAt) : undefined} />}
        {slip?.paidAt && <Stat label={t("salary.paidAt")} value={formatDate(slip.paidAt)} tone="green" />}
        <Stat label={t("salary.lessonsHeld")} value={result.lessonsHeld} />
      </div>
      {locked && slip!.total !== result.total && (
        <p className="mb-4 rounded-lg bg-amber-50 p-3 text-sm text-amber-800">{t("salary.changedAfterLock", { live: formatMoney(result.total), diff: formatMoney(result.total - slip!.total) })}</p>
      )}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <SalaryBreakdown ctx={ctx} result={locked ?? result} lessons={lessons} />
        </div>
        <div className="space-y-4">
          <Card
            title={t("salary.rule")}
            actions={
              <Modal label={t("salary.newRule")} title={t("salary.newRule")} variant="secondary" size="sm">
                <ModalForm action={saveRuleAction} className="space-y-3">
                  <input type="hidden" name="teacherId" value={teacherId} />
                  <Field label={t("salary.model")}>
                    <Select name="model" defaultValue={rules[0]?.model ?? "PERCENT_EARNED"}>
                      {(["PERCENT_EARNED", "FIXED", "PER_LESSON", "BASE_PLUS_PERCENT"] as const).map((m) => <option key={m} value={m}>{t(`salary.${m}`)}</option>)}
                    </Select>
                  </Field>
                  <FormGrid>
                    <Field label={t("salary.percent")}><Input name="percent" type="number" min={0} max={100} defaultValue={rules[0]?.percent ?? 40} /></Field>
                    <Field label={t("salary.fixedAmount")}><Input name="fixedAmount" inputMode="numeric" defaultValue={rules[0]?.fixedAmount ?? ""} /></Field>
                    <Field label={t("salary.perLesson")}><Input name="perLesson" inputMode="numeric" defaultValue={rules[0]?.perLesson ?? ""} /></Field>
                    <Field label={t("salary.validFrom")}><Input type="date" name="validFrom" defaultValue={monthRange(month).start} required /></Field>
                  </FormGrid>
                  <SubmitButton>{t("common.save")}</SubmitButton>
                </ModalForm>
              </Modal>
            }
          >
            {rules.length === 0 ? (
              <p className="text-sm text-amber-700">{t("salary.noRule")}</p>
            ) : (
              <Table>
                <tbody>
                  {rules.map((r) => (
                    <Tr key={r.id}>
                      <Td className="whitespace-nowrap text-xs">{formatDate(toISODate(r.validFrom))}</Td>
                      <Td className="text-xs">
                        {t(`salary.${r.model}`)}
                        {r.percent !== null && ` · ${r.percent}%`}
                        {r.fixedAmount !== null && ` · ${formatMoney(r.fixedAmount)}`}
                        {r.perLesson !== null && ` · ${formatMoney(r.perLesson)}`}
                      </Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
          <Card title={t("salary.adjustments")}>
            {(!slip || slip.status === "DRAFT") ? (
              <ActionForm action={adjustmentAction} reset className="space-y-2">
                <input type="hidden" name="teacherId" value={teacherId} />
                <input type="hidden" name="month" value={month} />
                <Input name="amount" placeholder="+300000 / −50000" required />
                <Input name="reason" placeholder={t("common.reason")} required />
                <p className="text-xs text-zinc-500">{t("salary.adjustmentHint")}</p>
                <SubmitButton variant="secondary" size="sm">{t("salary.addAdjustment")}</SubmitButton>
              </ActionForm>
            ) : (
              <p className="text-sm text-zinc-500">{t("error.locked")}</p>
            )}
            {result.adjustments.length > 0 && (
              <Table className="mt-3">
                <thead><tr><Th>{t("common.reason")}</Th><Th className="text-right">{t("common.amount")}</Th></tr></thead>
                <tbody>{result.adjustments.map((a, i) => <Tr key={a.id ?? i}><Td className="text-xs">{a.reason}</Td><Td className="whitespace-nowrap text-right text-xs">{formatMoney(a.amount)}</Td></Tr>)}</tbody>
              </Table>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
