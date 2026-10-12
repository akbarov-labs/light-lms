import type { Ctx } from "@/lib/ctx";
import { todayISO } from "@/lib/dates";
import { PaymentFormClient, type PayOption } from "./payment-form-client";

/** Take-payment form for a family; when opened from a student, that student's group and debt come first. */
export function PaymentForm({ ctx, familyId, familyName, options, familyDebt, studentId }: { ctx: Ctx; familyId: string; familyName: string; options: (PayOption & { studentId: string })[]; familyDebt: number; studentId?: string }) {
  const { t } = ctx;
  const mine = studentId ? options.filter((o) => o.studentId === studentId) : options;
  const preferred = mine.find((o) => o.debt > 0) ?? (studentId ? mine[0] : undefined);
  return (
    <PaymentFormClient
      familyId={familyId}
      studentId={studentId}
      options={options}
      defaultOption={preferred?.id ?? ""}
      familyDebt={familyDebt}
      familyWho={familyName}
      today={todayISO()}
      labels={{
        amount: t("common.amount"),
        method: t("common.method"),
        date: t("common.date"),
        forGroup: t("pay.forGroup"),
        anyGroup: t("pay.anyGroup"),
        note: t("common.note"),
        continue: t("pay.continue"),
        confirm: t("pay.confirm"),
        edit: t("pay.edit"),
        confirmTitle: t("pay.confirmTitle"),
        debtNow: t("pay.debtNow"),
        family: t("pay.family"),
        methods: { CASH: t("method.CASH"), CARD: t("method.CARD"), TRANSFER: t("method.TRANSFER") },
      }}
    />
  );
}
