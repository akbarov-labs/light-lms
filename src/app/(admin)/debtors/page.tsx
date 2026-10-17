import { CircleCheck } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/ctx";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { listDebtors } from "@/lib/queries/debtors";
import { pageParam, strParam } from "@/lib/queries/params";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Pagination, Stat, Table, Td, Th, Tr, cx } from "@/components/ui";
import { Input, Select } from "@/components/fields";
import { ActionForm } from "@/components/client";
import { CheckedCountSubmit } from "@/components/checked-submit";
import { remindAction } from "./actions";
import { listTeachers } from "@/lib/queries/staff";

export default async function DebtorsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireStaff();
  if (!ctx.can("payments.take") && !ctx.can("finance.view")) redirect("/forbidden");
  const { t } = ctx;
  const filters = { groupId: strParam(sp.groupId), teacherId: strParam(sp.teacherId), min: strParam(sp.min) };
  const [{ rows, total, totalDebt, page, pages }, groups, teachers] = await Promise.all([
    listDebtors(ctx, filters, { page: pageParam(sp.page) }),
    db.group.findMany({ where: { centerId: ctx.centerId, status: { in: ["ACTIVE", "PLANNED"] }, ...(ctx.branchIds ? { branchId: { in: ctx.branchIds } } : {}) }, select: { id: true, name: true, code: true }, orderBy: { name: "asc" } }),
    listTeachers(ctx.centerId),
  ]);
  const params = Object.fromEntries(Object.entries(filters).filter(([, v]) => v)) as Record<string, string>;
  const qs = new URLSearchParams(params).toString();
  const canRemind = ctx.can("payments.take");
  return (
    <>
      <PageHeader title={t("nav.debtors")} actions={ctx.can("export") && <LinkButton variant="secondary" href={`/api/export/debtors?${qs}`}>{t("common.export")}</LinkButton>} />
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label={t("debtors.total")} value={formatMoney(totalDebt)} tone={totalDebt > 0 ? "red" : undefined} />
        <Stat label={t("debtors.count")} value={total} />
      </div>
      <form className="mb-4 flex flex-wrap items-center gap-2 *:w-full *:min-w-0 sm:*:w-auto">
        <Select name="groupId" aria-label={t("common.group")} defaultValue={sp.groupId ?? ""}>
          <option value="">{t("common.group")}: {t("common.all")}</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name} #{g.code}</option>)}
        </Select>
        <Select name="teacherId" aria-label={t("common.teacher")} defaultValue={sp.teacherId ?? ""}>
          <option value="">{t("common.teacher")}: {t("common.all")}</option>
          {teachers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Select>
        <Input name="min" inputMode="numeric" defaultValue={sp.min} placeholder={t("debtors.minAmount")} aria-label={t("debtors.minAmount")} />
        <button className="h-9 rounded-lg bg-zinc-900 px-3.5 text-sm font-medium text-white hover:bg-zinc-800">{t("common.filter")}</button>
      </form>
      <Card pad={false}>
        {rows.length === 0 ? (
          qs ? (
            <EmptyState action={<LinkButton variant="secondary" size="sm" href="/debtors">{t("empty.clear")}</LinkButton>}>{t("empty.filtered")}</EmptyState>
          ) : (
            <EmptyState icon={<CircleCheck className="h-6 w-6 text-emerald-600" strokeWidth={1.5} />} title={t("empty.debtorsTitle")}>{t("empty.debtors")}</EmptyState>
          )
        ) : (
          <ActionForm action={remindAction}>
            {canRemind && (
              <div className="flex justify-end border-b border-zinc-100 px-4 py-2.5">
                <CheckedCountSubmit name="familyId" label={t("debtors.remindSelected", { n: "{n}" })} confirm={t("debtors.remindConfirm", { n: "{n}" })} selectAllLabel={t("debtors.selectAll")} />
              </div>
            )}
            <Table>
              <thead>
                <tr>{canRemind && <Th />}<Th>{t("common.students")}</Th><Th>{t("common.groups")}</Th><Th className="text-right">{t("common.debt")}</Th><Th className="text-right">{t("debtors.daysOverdue")}</Th><Th>{t("debtors.lastPayment")}</Th><Th>{t("common.phone")}</Th><Th /></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.familyId}>
                    {canRemind && <Td><input type="checkbox" name="familyId" value={r.familyId} disabled={!r.telegram} aria-label={`${t("debtors.remind")}: ${r.students.map((x) => x.name).join(", ")}`} className="h-4 w-4 accent-[rgb(var(--accent))]" /></Td>}
                    <Td>
                      {r.students.map((s) => <Link key={s.id} href={`/students/${s.id}`} className="block font-medium text-zinc-900 hover:underline hover:decoration-zinc-400">{s.name}</Link>)}
                    </Td>
                    <Td className="text-xs">{r.groups.map((g) => g.name).join(", ") || "—"}</Td>
                    <Td className="whitespace-nowrap text-right font-semibold text-red-600"><Link href={`/families/${r.familyId}?pay=1`}>{formatMoney(r.debt)}</Link></Td>
                    <Td className={cx("text-right", r.daysOverdue > 30 ? "font-semibold text-red-600" : "")}>{r.daysOverdue}</Td>
                    <Td className="whitespace-nowrap text-xs">{formatDate(r.lastPayment)}</Td>
                    <Td className="whitespace-nowrap text-xs">{r.phone ? <a href={`tel:+${r.phone}`} className="text-zinc-900 underline decoration-zinc-300 hover:decoration-zinc-900">{formatPhone(r.phone)}</a> : "—"}</Td>
                    <Td>{r.telegram ? <Badge tone="blue">Telegram</Badge> : <span className="text-xs text-zinc-500" title={t("debtors.noTelegram")}>☎</span>}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </ActionForm>
        )}
        <Pagination page={page} pages={pages} params={params} path="/debtors" t={t} />
      </Card>
    </>
  );
}
