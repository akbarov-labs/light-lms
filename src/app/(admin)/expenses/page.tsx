import { requireStaff } from "@/lib/ctx";
import { db } from "@/lib/db";
import { formatDate, monthRange, toISODate, todayISO } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { listExpenses } from "@/lib/queries/expenses";
import { Card, EmptyState, LinkButton, PageHeader, Stat, Table, Td, Th, Tr } from "@/components/ui";
import { Field, FormGrid, Input, Select } from "@/components/fields";
import { ActionForm, Modal, ModalForm, SubmitButton } from "@/components/client";
import { addExpenseAction, reverseExpenseAction } from "./actions";

export default async function ExpensesPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireStaff("finance.view");
  const { t } = ctx;
  const m = monthRange(todayISO().slice(0, 7));
  const [{ rows, users, total }, branches] = await Promise.all([
    listExpenses(ctx, sp),
    db.branch.findMany({ where: { centerId: ctx.centerId, archivedAt: null, ...(ctx.branchIds ? { id: { in: ctx.branchIds } } : {}) }, orderBy: { name: "asc" } }),
  ]);
  const categories = [...new Set([...ctx.settings.expenseCategories, ...rows.map((r) => r.category)])];
  const byCat = new Map<string, number>();
  for (const r of rows) if (!r.reversedAt) byCat.set(r.category, (byCat.get(r.category) ?? 0) + r.amount);
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();
  const canReverse = ctx.can("payments.refund") || ctx.can("archive");
  return (
    <>
      <PageHeader
        title={t("nav.expenses")}
        actions={
          <>
            {ctx.can("export") && <LinkButton variant="secondary" href={`/api/export/expenses?${qs}`}>{t("common.export")}</LinkButton>}
            <Modal label={`+ ${t("expenses.new")}`} title={t("expenses.new")}>
              <ModalForm action={addExpenseAction} className="space-y-3">
                <FormGrid>
                  <Field label={t("expenses.category")}>
                    <Input name="category" list="expense-cats" required defaultValue={categories[0]} />
                    <datalist id="expense-cats">{categories.map((c) => <option key={c} value={c} />)}</datalist>
                  </Field>
                  <Field label={t("common.amount")}><Input name="amount" inputMode="numeric" required /></Field>
                  <Field label={t("common.date")}><Input type="date" name="date" defaultValue={todayISO()} required /></Field>
                  <Field label={t("common.branch")}>
                    <Select name="branchId" defaultValue={ctx.activeBranchId ?? (ctx.branchIds ? branches[0]?.id : "")}>
                      {!ctx.branchIds && <option value="">{t("expenses.centerWide")}</option>}
                      {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                    </Select>
                  </Field>
                </FormGrid>
                <Field label={t("common.note")}><Input name="note" /></Field>
                <SubmitButton>{t("common.add")}</SubmitButton>
              </ModalForm>
            </Modal>
          </>
        }
      />
      <form className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Input type="date" name="from" defaultValue={sp.from ?? m.start} />
        <Input type="date" name="to" defaultValue={sp.to ?? m.end} />
        <Select name="category" defaultValue={sp.category ?? ""}>
          <option value="">{t("expenses.category")}: {t("common.all")}</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </Select>
        <button className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-medium text-white">{t("common.filter")}</button>
      </form>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t("common.total")} value={formatMoney(total)} />
        {[...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3).map(([c, v]) => <Stat key={c} label={c} value={formatMoney(v)} />)}
      </div>
      <Card pad={false}>
        {rows.length === 0 ? (
          <EmptyState>{t("common.empty")}</EmptyState>
        ) : (
          <Table>
            <thead><tr><Th>{t("common.date")}</Th><Th>{t("expenses.category")}</Th><Th>{t("common.branch")}</Th><Th>{t("common.note")}</Th><Th className="text-right">{t("common.amount")}</Th><Th>{t("common.createdBy")}</Th><Th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id} className={r.reversedAt ? "opacity-50 line-through" : ""}>
                  <Td className="whitespace-nowrap text-xs">{formatDate(toISODate(r.date))}</Td>
                  <Td>{r.category}</Td>
                  <Td className="text-xs">{r.branch?.name ?? t("expenses.centerWide")}</Td>
                  <Td className="text-xs">{r.note}</Td>
                  <Td className="whitespace-nowrap text-right font-medium">{formatMoney(r.amount)}</Td>
                  <Td className="text-xs">{users.get(r.createdById) ?? "—"}</Td>
                  <Td className="text-right">
                    {!r.reversedAt && canReverse && (
                      <ActionForm action={reverseExpenseAction}>
                        <input type="hidden" name="id" value={r.id} />
                        <SubmitButton variant="ghost" size="sm" confirm={t("common.confirm")}>{t("expenses.reverse")}</SubmitButton>
                      </ActionForm>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
