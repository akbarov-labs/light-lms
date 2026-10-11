import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/ctx";
import { db } from "@/lib/db";
import { formatDate, monthRange, toISODate, todayISO } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { listPayments } from "@/lib/queries/payments";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Pagination, Stat, Table, Td, Th, Tr, cx } from "@/components/ui";
import { Input, Select } from "@/components/fields";

const PAGE = 50;

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireStaff();
  if (!ctx.can("payments.take") && !ctx.can("finance.view")) redirect("/forbidden");
  const { t } = ctx;
  const page = Math.max(1, Number(sp.page) || 1);
  const month = monthRange(todayISO().slice(0, 7));
  const { rows, total, users, totals } = await listPayments(ctx, sp, { skip: (page - 1) * PAGE, take: PAGE });
  const cashiers = await db.user.findMany({ where: { centerId: ctx.centerId, role: { not: "TEACHER" } }, select: { id: true, name: true }, orderBy: { name: "asc" } });
  const qs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "page") as [string, string][]).toString();
  return (
    <>
      <PageHeader title={t("nav.payments")} actions={ctx.can("export") && <LinkButton variant="secondary" href={`/api/export/payments?${qs}`}>{t("common.export")}</LinkButton>} />
      <form className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-6">
        <Input type="date" name="from" defaultValue={sp.from ?? month.start} />
        <Input type="date" name="to" defaultValue={sp.to ?? month.end} />
        <Select name="type" defaultValue={sp.type ?? ""}>
          <option value="">{t("payments.typeAll")}</option>
          <option value="PAYMENT">{t("payments.onlyPayments")}</option>
          <option value="REFUND">{t("payments.onlyRefunds")}</option>
          <option value="REVERSAL">{t("payments.onlyReversals")}</option>
        </Select>
        <Select name="method" defaultValue={sp.method ?? ""}>
          <option value="">{t("common.method")}: {t("common.all")}</option>
          {(["CASH", "CARD", "TRANSFER", "PAYME"] as const).map((m) => <option key={m} value={m}>{t(`method.${m}`)}</option>)}
        </Select>
        <Select name="cashier" defaultValue={sp.cashier ?? ""}>
          <option value="">{t("payments.cashierAll")}</option>
          {cashiers.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </Select>
        <div className="flex gap-2">
          <Input name="q" defaultValue={sp.q} placeholder={t("common.search")} />
          <button className="rounded-lg bg-slate-800 px-3 py-2 text-sm font-medium text-white">{t("common.filter")}</button>
        </div>
      </form>
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label={t("payments.received")} value={formatMoney(totals.payments)} tone="green" />
        <Stat label={t("payments.onlyRefunds")} value={formatMoney(totals.refunds)} />
        <Stat label={t("payments.onlyReversals")} value={formatMoney(totals.reversals)} />
        <Stat label={t("payments.net")} value={formatMoney(totals.net)} />
      </div>
      <Card pad={false}>
        {rows.length === 0 ? (
          <EmptyState>{t("common.empty")}</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr><Th>{t("common.date")}</Th><Th>№</Th><Th>{t("payments.family")}</Th><Th>{t("common.method")}</Th><Th className="text-right">{t("common.amount")}</Th><Th>{t("pay.cashier")}</Th></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <Tr key={r.id} className={r.reversedBy ? "opacity-50" : ""}>
                  <Td className="whitespace-nowrap text-xs">{formatDate(toISODate(r.date))}</Td>
                  <Td className="text-xs">{r.receiptNo ? <Link href={`/r/${r.id}`} className="text-accent hover:underline">{r.receiptNo}</Link> : "—"}</Td>
                  <Td>
                    <Link href={`/families/${r.family.id}`} className="font-medium text-slate-900 hover:text-accent">{r.student ? `${r.student.lastName} ${r.student.firstName}` : r.family.name}</Link>
                    <div className="text-xs text-slate-500">{r.type !== "PAYMENT" && <Badge tone={r.type === "REFUND" ? "amber" : "red"}>{t(`ledger.${r.type}`)}</Badge>} {r.description}</div>
                  </Td>
                  <Td>{r.method ? t(`method.${r.method}`) : "—"}</Td>
                  <Td className={cx("whitespace-nowrap text-right font-medium", r.amount < 0 ? "text-rose-600" : "text-emerald-700")}>{formatMoney(r.amount)}</Td>
                  <Td className="text-xs">{r.createdById ? users.get(r.createdById) : "Payme"}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pages={Math.ceil(total / PAGE)} params={sp} path="/payments" t={t} />
      </Card>
    </>
  );
}
