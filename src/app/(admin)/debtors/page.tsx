import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/ctx";
import { db } from "@/lib/db";
import { formatDate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { listDebtors } from "@/lib/queries/debtors";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Stat, Table, Td, Th, Tr, cx } from "@/components/ui";
import { Input, Select } from "@/components/fields";
import { ActionForm, SubmitButton } from "@/components/client";
import { remindAction } from "./actions";

export default async function DebtorsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireStaff();
  if (!ctx.can("payments.take") && !ctx.can("finance.view")) redirect("/forbidden");
  const { t } = ctx;
  const [rows, groups, teachers] = await Promise.all([
    listDebtors(ctx, sp),
    db.group.findMany({ where: { centerId: ctx.centerId, status: { in: ["ACTIVE", "PLANNED"] }, ...(ctx.branchIds ? { branchId: { in: ctx.branchIds } } : {}) }, select: { id: true, name: true, code: true }, orderBy: { name: "asc" } }),
    db.user.findMany({ where: { centerId: ctx.centerId, archivedAt: null, OR: [{ isTeacher: true }, { role: "TEACHER" }] }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const total = rows.reduce((s, r) => s + r.debt, 0);
  const qs = new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString();
  const canRemind = ctx.can("payments.take");
  return (
    <>
      <PageHeader title={t("nav.debtors")} actions={ctx.can("export") && <LinkButton variant="secondary" href={`/api/export/debtors?${qs}`}>{t("common.export")}</LinkButton>} />
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t("debtors.total")} value={formatMoney(total)} tone="red" />
        <Stat label={t("debtors.count")} value={rows.length} />
      </div>
      <form className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Select name="groupId" defaultValue={sp.groupId ?? ""}>
          <option value="">{t("common.group")}: {t("common.all")}</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name} #{g.code}</option>)}
        </Select>
        <Select name="teacherId" defaultValue={sp.teacherId ?? ""}>
          <option value="">{t("common.teacher")}: {t("common.all")}</option>
          {teachers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Select>
        <Input name="min" inputMode="numeric" defaultValue={sp.min} placeholder={t("debtors.minAmount")} />
        <button className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-medium text-white">{t("common.filter")}</button>
      </form>
      <Card pad={false}>
        {rows.length === 0 ? (
          <EmptyState>{t("common.empty")}</EmptyState>
        ) : (
          <ActionForm action={remindAction}>
            {canRemind && (
              <div className="flex justify-end border-b border-slate-100 p-3">
                <SubmitButton variant="secondary" size="sm">{t("debtors.remindAll")}</SubmitButton>
              </div>
            )}
            <Table>
              <thead>
                <tr>{canRemind && <Th />}<Th>{t("common.students")}</Th><Th>{t("common.groups")}</Th><Th className="text-right">{t("common.debt")}</Th><Th className="text-right">{t("debtors.daysOverdue")}</Th><Th>{t("debtors.lastPayment")}</Th><Th>{t("common.phone")}</Th><Th /></tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <Tr key={r.familyId}>
                    {canRemind && <Td><input type="checkbox" name="familyId" value={r.familyId} defaultChecked={r.telegram} disabled={!r.telegram} className="h-4 w-4" /></Td>}
                    <Td>
                      {r.students.map((s) => <Link key={s.id} href={`/students/${s.id}`} className="block font-medium text-slate-900 hover:text-accent">{s.name}</Link>)}
                    </Td>
                    <Td className="text-xs">{r.groups.map((g) => g.name).join(", ") || "—"}</Td>
                    <Td className="whitespace-nowrap text-right font-semibold text-rose-600"><Link href={`/families/${r.familyId}?pay=1`}>{formatMoney(r.debt)}</Link></Td>
                    <Td className={cx("text-right", r.daysOverdue > 30 ? "font-semibold text-rose-600" : "")}>{r.daysOverdue}</Td>
                    <Td className="whitespace-nowrap text-xs">{formatDate(r.lastPayment)}</Td>
                    <Td className="whitespace-nowrap text-xs">{r.phone ? <a href={`tel:+${r.phone}`} className="text-accent">{formatPhone(r.phone)}</a> : "—"}</Td>
                    <Td>{r.telegram ? <Badge tone="blue">Telegram</Badge> : <span className="text-xs text-slate-400" title={t("debtors.noTelegram")}>☎</span>}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </ActionForm>
        )}
      </Card>
    </>
  );
}
