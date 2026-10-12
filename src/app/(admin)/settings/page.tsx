import { requireStaff } from "@/lib/ctx";
import { db } from "@/lib/db";
import { readSettings } from "@/lib/settings";
import { Card } from "@/components/ui";
import { Checkbox, Field, FormGrid, Input, Select, Textarea } from "@/components/fields";
import { ActionForm, SubmitButton } from "@/components/client";
import { saveCenterAction } from "./actions";

export default async function CenterSettings() {
  const ctx = await requireStaff("settings");
  const { t } = ctx;
  const c = await db.center.findUniqueOrThrow({ where: { id: ctx.centerId } });
  const s = readSettings(c.settings);
  const appUrl = process.env.APP_URL ?? "http://localhost:3000";
  return (
    <ActionForm action={saveCenterAction} className="space-y-5">
      <Card title={t("settings.center")}>
        <FormGrid cols={3}>
          <Field label={t("settings.centerName")}><Input name="name" defaultValue={c.name} required /></Field>
          <Field label={t("settings.slug")} hint={`${appUrl}/f/${c.slug}`}><Input name="slug" defaultValue={c.slug} required pattern="[a-z0-9-]{2,40}" /></Field>
          <Field label={t("common.phone")}><Input name="phone" defaultValue={c.phone ?? ""} /></Field>
          <Field label={t("settings.accent")}><Input type="color" name="accentColor" defaultValue={c.accentColor} className="h-10 p-1" /></Field>
          <Field label={t("settings.logo")}><Input name="logoUrl" defaultValue={c.logoUrl ?? ""} /></Field>
          <Field label={t("settings.locale")}>
            <Select name="locale" defaultValue={c.locale}>
              <option value="uz">O&apos;zbekcha</option>
              <option value="ru">Русский</option>
            </Select>
          </Field>
        </FormGrid>
      </Card>
      <Card title={t("settings.billing")}>
        <FormGrid cols={4}>
          <Field label={t("settings.trialLessons")}><Input type="number" min={0} max={10} name="trialLessons" defaultValue={s.trialLessons} /></Field>
          <Field label={t("settings.reminderDaysBefore")}><Input type="number" min={0} max={15} name="reminderDaysBefore" defaultValue={s.reminderDaysBefore} /></Field>
          <Field label={t("settings.lessonsAheadDays")}><Input type="number" min={31} max={180} name="lessonsAheadDays" defaultValue={s.lessonsAheadDays} /></Field>
          <Field label={t("settings.gradeScale")}>
            <Select name="gradeScale" defaultValue={s.gradeScale}>
              <option value="5">1–5</option>
              <option value="100">0–100</option>
            </Select>
          </Field>
        </FormGrid>
        <div className="mt-4 grid gap-2 sm:grid-cols-2">
          <Checkbox name="excusedAbsenceCredit" label={t("settings.excusedAbsenceCredit")} defaultChecked={s.excusedAbsenceCredit} />
          <Checkbox name="payTeacherForTrial" label={t("settings.payTeacherForTrial")} defaultChecked={s.payTeacherForTrial} />
          <Checkbox name="payFromCollected" label={t("settings.payFromCollected")} defaultChecked={s.payFromCollected} />
          <Checkbox name="transferAsTrial" label={t("settings.transferAsTrial")} defaultChecked={s.transferAsTrial} />
        </div>
      </Card>
      <Card title={t("settings.expenseCategories")}>
        <Field hint={t("expenses.categoriesHint")}><Textarea name="expenseCategories" rows={6} defaultValue={s.expenseCategories.join("\n")} /></Field>
      </Card>
      <Card title={t("settings.notifications")}>
        <div className="grid gap-2 sm:grid-cols-2">
          {(["payment", "reminder", "debt", "absence", "trial", "teacherReminder", "dailyReport"] as const).map((k) => (
            <Checkbox key={k} name={`notify.${k}`} label={t(`settings.notify.${k}`)} defaultChecked={s.notify[k]} />
          ))}
        </div>
      </Card>
      <Card title={t("settings.payme")}>
        <p className="mb-3 text-sm text-zinc-500">{t("settings.paymeHint")}</p>
        <FormGrid cols={3}>
          <Field label={t("settings.paymeMerchantId")}><Input name="paymeMerchantId" defaultValue={c.paymeMerchantId ?? ""} autoComplete="off" /></Field>
          <Field label={t("settings.paymeKey")} hint={c.paymeKey ? "••••••  (−  = o'chirish)" : undefined}><Input name="paymeKey" type="password" autoComplete="new-password" placeholder={c.paymeKey ? "••••••" : ""} /></Field>
          <div className="pt-6"><Checkbox name="paymeTestMode" label={t("settings.paymeTestMode")} defaultChecked={c.paymeTestMode} /></div>
        </FormGrid>
        <p className="mt-3 text-xs text-zinc-500">{t("settings.paymeEndpoint")}: <code className="rounded bg-zinc-100 px-1 text-zinc-700">{appUrl}/api/payme</code></p>
      </Card>
      <div className="sticky bottom-4 z-10 flex justify-end rounded-xl border border-line bg-white/95 p-2 shadow-pop backdrop-blur"><SubmitButton>{t("common.save")}</SubmitButton></div>
    </ActionForm>
  );
}
