import type { Ctx } from "@/lib/ctx";
import { todayISO } from "@/lib/dates";
import { Field, FormGrid, Input, Select } from "./fields";
import { ActionForm, SubmitButton } from "./client";
import { takePaymentAction } from "@/app/(admin)/payments/actions";

/** Take-payment form for a family (optionally pointed at one of its enrollments). */
export function PaymentForm({ ctx, familyId, enrollments, defaultAmount, studentId }: { ctx: Ctx; familyId: string; enrollments: { id: string; label: string }[]; defaultAmount?: number; studentId?: string }) {
  const { t } = ctx;
  return (
    <ActionForm action={takePaymentAction} className="space-y-3">
      <input type="hidden" name="familyId" value={familyId} />
      {studentId && <input type="hidden" name="studentId" value={studentId} />}
      <FormGrid>
        <Field label={t("common.amount")}><Input name="amount" inputMode="numeric" required defaultValue={defaultAmount && defaultAmount > 0 ? defaultAmount : ""} placeholder="600 000" autoFocus /></Field>
        <Field label={t("common.method")}>
          <Select name="method" defaultValue="CASH">
            {(["CASH", "CARD", "TRANSFER"] as const).map((m) => <option key={m} value={m}>{t(`method.${m}`)}</option>)}
          </Select>
        </Field>
        <Field label={t("common.date")}><Input type="date" name="date" defaultValue={todayISO()} required /></Field>
        <Field label={t("pay.forGroup")}>
          <Select name="enrollmentId" defaultValue="">
            <option value="">{t("pay.anyGroup")}</option>
            {enrollments.map((e) => <option key={e.id} value={e.id}>{e.label}</option>)}
          </Select>
        </Field>
      </FormGrid>
      <Field label={t("common.note")}><Input name="note" /></Field>
      <SubmitButton>{t("students.takePayment")}</SubmitButton>
    </ActionForm>
  );
}
