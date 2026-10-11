import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/ctx";
import { db } from "@/lib/db";
import { formatDate, formatDateTime, toISODate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { fullName } from "@/lib/format";
import { formatPhone } from "@/lib/phone";
import { PrintButton } from "@/components/client";
import { LinkButton } from "@/components/ui";

export default async function ReceiptPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireStaff();
  const { t } = ctx;
  const entry = await db.ledgerEntry.findFirst({
    where: { id, centerId: ctx.centerId, type: { in: ["PAYMENT", "REFUND"] } },
    include: { family: { include: { students: { select: { firstName: true, lastName: true } } } }, student: true, center: true, enrollment: { include: { group: { select: { name: true, code: true } } } }, reversedBy: true },
  });
  if (!entry) notFound();
  const [cashier, after] = await Promise.all([
    entry.createdById ? db.user.findUnique({ where: { id: entry.createdById }, select: { name: true } }) : null,
    db.ledgerEntry.aggregate({ where: { familyId: entry.familyId, createdAt: { lte: entry.createdAt } }, _sum: { amount: true } }),
  ]);
  const who = entry.student ? fullName(entry.student) : entry.family.students.map(fullName).join(", ");
  const rows: [string, string][] = [
    [t("common.date"), `${formatDate(toISODate(entry.date))} (${formatDateTime(entry.createdAt)})`],
    [t("common.student"), who],
    ...(entry.enrollment ? [[t("common.group"), `${entry.enrollment.group.name} #${entry.enrollment.group.code}`] as [string, string]] : []),
    [t("common.method"), entry.method ? t(`method.${entry.method}`) : "—"],
    [t("pay.cashier"), cashier?.name ?? "—"],
    [t("pay.newBalance"), formatMoney(after._sum.amount ?? 0)],
  ];
  return (
    <div className="mx-auto max-w-sm">
      <div className="mb-4 flex gap-2 print:hidden">
        <PrintButton label={t("common.print")} />
        <LinkButton variant="secondary" href={`/families/${entry.familyId}`}>{t("family.wallet")}</LinkButton>
      </div>
      <div className="rounded-xl border border-slate-200 bg-white p-5 font-mono text-sm shadow-sm print:border-0 print:p-0 print:shadow-none">
        <div className="text-center">
          <div className="text-base font-bold">{entry.center.name}</div>
          {entry.center.phone && <div className="text-xs">{formatPhone(entry.center.phone)}</div>}
          <div className="mt-2 border-y border-dashed border-slate-300 py-1 text-xs uppercase">
            {entry.type === "REFUND" ? `${t("ledger.REFUND")} · ` : ""}{t("pay.receiptNo")} {entry.receiptNo}
          </div>
        </div>
        <div className="my-3 text-center text-2xl font-bold">{formatMoney(Math.abs(entry.amount))}</div>
        <dl className="space-y-1">
          {rows.map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3"><dt className="text-slate-500">{k}</dt><dd className="text-right">{v}</dd></div>
          ))}
        </dl>
        {entry.reversedBy && <div className="mt-3 rounded bg-rose-50 p-2 text-center text-xs font-bold uppercase text-rose-700">{t("pay.reversed")}</div>}
        <div className="mt-4 border-t border-dashed border-slate-300 pt-2 text-center text-xs">{t("pay.thanks")}</div>
      </div>
      <div className="mt-3 text-center text-xs print:hidden"><Link href="/payments" className="text-slate-500 hover:text-slate-800">{t("nav.payments")} →</Link></div>
    </div>
  );
}
