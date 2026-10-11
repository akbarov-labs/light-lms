import type { Ctx } from "@/lib/ctx";
import { formatDate, toISODate } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import Link from "next/link";
import { Badge, EmptyState, Table, Td, Th, Tr, cx } from "./ui";
import { Field, Input } from "./fields";
import { Modal, ModalForm, SubmitButton } from "./client";
import { reverseAction } from "@/app/(admin)/payments/actions";

export interface LedgerRow {
  id: string;
  type: "CHARGE" | "CREDIT" | "PAYMENT" | "REFUND" | "REVERSAL";
  amount: number;
  date: Date;
  method: string | null;
  description: string;
  receiptNo: number | null;
  student?: { firstName: string; lastName: string } | null;
  reversedBy?: { id: string } | null;
}

const typeTone = { CHARGE: "gray", CREDIT: "blue", PAYMENT: "green", REFUND: "amber", REVERSAL: "red" } as const;

/** Ledger rows newest first with a running balance; payments can be reversed (with permission). */
export function LedgerTable({ ctx, rows, showStudent }: { ctx: Ctx; rows: LedgerRow[]; showStudent?: boolean }) {
  const { t } = ctx;
  if (rows.length === 0) return <EmptyState>{t("common.empty")}</EmptyState>;
  let running = 0;
  const withBalance = rows.map((r) => ({ ...r, balance: (running += r.amount) }));
  return (
    <Table>
      <thead>
        <tr><Th>{t("common.date")}</Th><Th>{t("common.description")}</Th>{showStudent && <Th>{t("common.student")}</Th>}<Th className="text-right">{t("common.amount")}</Th><Th className="text-right">{t("common.balance")}</Th><Th /></tr>
      </thead>
      <tbody>
        {withBalance.reverse().map((r) => (
          <Tr key={r.id} className={r.reversedBy ? "opacity-50" : ""}>
            <Td className="whitespace-nowrap text-xs">{formatDate(toISODate(r.date))}</Td>
            <Td>
              <Badge tone={typeTone[r.type]}>{t(`ledger.${r.type}`)}</Badge> <span className="text-sm">{r.description}</span>
              {r.reversedBy && <span className="ml-1 text-xs text-rose-600">({t("pay.reversed")})</span>}
            </Td>
            {showStudent && <Td className="text-xs">{r.student ? `${r.student.lastName} ${r.student.firstName}` : "—"}</Td>}
            <Td className={cx("whitespace-nowrap text-right font-medium", r.amount < 0 ? "text-slate-700" : "text-emerald-700")}>{r.amount > 0 ? "+" : ""}{formatMoney(r.amount)}</Td>
            <Td className={cx("whitespace-nowrap text-right text-xs", r.balance < 0 ? "text-rose-600" : "text-slate-500")}>{formatMoney(r.balance)}</Td>
            <Td className="whitespace-nowrap text-right">
              {(r.type === "PAYMENT" || r.type === "REFUND") && r.receiptNo && <Link href={`/r/${r.id}`} className="mr-2 text-xs text-accent hover:underline">{t("pay.receipt")}</Link>}
              {(r.type === "PAYMENT" || r.type === "REFUND") && !r.reversedBy && ctx.can("payments.refund") && (
                <Modal label={t("pay.reverse")} title={t("pay.reverseTitle")} variant="ghost" size="sm">
                  <ModalForm action={reverseAction} className="space-y-3">
                    <input type="hidden" name="entryId" value={r.id} />
                    <p className="text-sm">{r.description} · <b>{formatMoney(r.amount)}</b></p>
                    <Field label={t("common.reason")}><Input name="reason" required /></Field>
                    <p className="text-xs text-slate-500">{t("pay.reverseHint")}</p>
                    <SubmitButton variant="danger">{t("pay.reverse")}</SubmitButton>
                  </ModalForm>
                </Modal>
              )}
            </Td>
          </Tr>
        ))}
      </tbody>
    </Table>
  );
}
