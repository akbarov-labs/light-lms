import { requireStaff } from "@/lib/ctx";
import { db } from "@/lib/db";
import { readSettings, SMS_EVENTS } from "@/lib/settings";
import { Card } from "@/components/ui";
import { Checkbox, Field, FormGrid, Input, Select, Textarea } from "@/components/fields";
import { ActionForm, SubmitButton } from "@/components/client";
import { saveCenterAction } from "./actions";
import { appUrl as envAppUrl } from "@/lib/env";

export default async function CenterSettings() {
  const ctx = await requireStaff("settings");
  const { t } = ctx;
  const c = await db.center.findUniqueOrThrow({ where: { id: ctx.centerId } });
  const s = readSettings(c.settings);
  const appUrl = envAppUrl();
  return (
    <ActionForm action={saveCenterAction} className="space-y-5">
      <Card title={t("settings.center")}>
        <FormGrid cols={3}>
          <Field label={t("settings.centerName")}><Input name="name" defaultValue={c.name} required /></Field>
          <Field label={t("settings.slug")} hint={`${appUrl}/f/${c.slug}`}><Input name="slug" defaultValue={c.slug} required pattern="[a-z0-9\-]{2,40}" /></Field>
          <Field label={t("common.phone")}><Input name="phone" defaultValue={c.phone ?? ""} /></Field>
          <Field label={t("settings.accent")}><Input type="color" name="accentColor" defaultValue={c.accentColor} /></Field>
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
        <p className="mt-4 mb-2 text-sm text-zinc-500">{t("settings.makeupDays")}</p>
        <div className="flex flex-wrap gap-3">
          {[1, 2, 3, 4, 5, 6, 7].map((d) => (
            <Checkbox key={d} name="makeupDays" value={String(d)} label={t(`common.weekday.${d}` as "common.weekday.1")} defaultChecked={s.makeupWeekdays.includes(d)} />
          ))}
        </div>
      </Card>
      <Card title={t("settings.reportCards")}>
        <div className="grid items-end gap-3 sm:grid-cols-2">
          <Checkbox name="reportCardsAuto" label={t("settings.reportCardsAuto")} defaultChecked={s.reportCards.autoSend} />
          <Field label={t("settings.reportCardsDay")}><Input type="number" min={1} max={28} name="reportCardsDay" defaultValue={s.reportCards.sendDay} /></Field>
        </div>
        <p className="mt-4 mb-2 text-sm text-zinc-500">{t("settings.weeklyHint")}</p>
        <div className="grid items-end gap-3 sm:grid-cols-3">
          <Checkbox name="weeklyReport" label={t("settings.weeklyReport")} defaultChecked={s.parentReports.weekly} />
          <Field label={t("settings.weeklyDay")}>
            <Select name="weeklyDay" defaultValue={String(s.parentReports.weekday)}>
              {[1, 2, 3, 4, 5, 6, 7].map((d) => <option key={d} value={d}>{t(`common.weekday.${d}` as "common.weekday.1")}</option>)}
            </Select>
          </Field>
          <Field label={t("settings.weeklyHour")}><Input type="number" min={8} max={22} name="weeklyHour" defaultValue={s.parentReports.hour} /></Field>
        </div>
      </Card>
      <Card title={t("settings.homework")}>
        <p className="mb-3 text-sm text-zinc-500">{t("settings.homeworkHint")}</p>
        <div className="grid items-end gap-3 sm:grid-cols-2">
          <Checkbox name="homeworkEnabled" label={t("settings.homeworkEnabled")} defaultChecked={s.homework.enabled} />
          <Field label={t("settings.homeworkDirectFromGrade")} hint={t("settings.homeworkDirectHint")}>
            <Input type="number" min={1} max={12} name="homeworkDirectFromGrade" defaultValue={s.homework.directFromGrade} />
          </Field>
          <Field label={t("settings.homeworkDueMinutes")} hint={t("settings.homeworkDueMinutesHint")}>
            <Input type="number" min={0} max={720} step={15} name="homeworkDueMinutes" defaultValue={s.homework.dueMinutesBefore} />
          </Field>
          <Field label={t("settings.homeworkLateDays")} hint={t("settings.homeworkLateDaysHint")}>
            <Input type="number" min={0} max={7} name="homeworkLateDays" defaultValue={s.homework.lateDays} />
          </Field>
          <Field label={t("settings.homeworkAttempts")} hint={t("settings.homeworkAttemptsHint")}>
            <Input type="number" min={0} max={5} name="homeworkAttempts" defaultValue={s.homework.attempts} />
          </Field>
          <Field label={t("settings.homeworkRemindHours")} hint={t("settings.homeworkRemindHoursHint")}>
            <Input type="number" min={0} max={48} name="homeworkRemindHours" defaultValue={s.homework.remindHoursBefore} />
          </Field>
          <div className="sm:col-span-2">
            <Checkbox name="homeworkPhotos" label={t("settings.homeworkPhotos")} defaultChecked={s.homework.photos} />
            <p className="mt-1 text-xs text-zinc-500">{t("settings.homeworkPhotosHint")}</p>
          </div>
        </div>
      </Card>
      <Card title={t("settings.tutor")}>
        <p className="mb-3 text-sm text-zinc-500">{t("settings.tutorHint")}</p>
        <div className="grid items-end gap-3 sm:grid-cols-2">
          <Checkbox name="tutorEnabled" label={t("settings.tutorEnabled")} defaultChecked={s.tutor.enabled} />
          <Field label={t("settings.tutorDaily")} hint={t("settings.tutorDailyHint")}>
            <Input type="number" min={1} max={200} name="tutorDailyMessages" defaultValue={s.tutor.dailyMessages} />
          </Field>
        </div>
      </Card>
      <Card title={t("settings.expenseCategories")}>
        <Field hint={t("expenses.categoriesHint")}><Textarea name="expenseCategories" rows={6} defaultValue={s.expenseCategories.join("\n")} /></Field>
      </Card>
      <Card title={t("settings.notifications")}>
        <div className="grid gap-2 sm:grid-cols-2">
          {(["payment", "reminder", "debt", "debtDaily", "absence", "trial", "teacherReminder", "dailyReport", "reportCard", "examResult"] as const).map((k) => (
            <Checkbox key={k} name={`notify.${k}`} label={t(`settings.notify.${k}`)} defaultChecked={s.notify[k]} />
          ))}
        </div>
        <div className="mt-3 max-w-xs">
          <Field label={t("settings.dailyReportHour")}>
            <Input type="number" min={6} max={23} name="dailyReportHour" defaultValue={s.dailyReportHour} />
          </Field>
        </div>
      </Card>
      <Card title={t("settings.payme")}>
        <p className="mb-3 text-sm text-zinc-500">{t("settings.paymeHint")}</p>
        <FormGrid cols={3}>
          <Field label={t("settings.paymeMerchantId")}><Input name="paymeMerchantId" defaultValue={c.paymeMerchantId ?? ""} autoComplete="off" /></Field>
          <Field label={t("settings.paymeKey")} hint={c.paymeKey ? "••••••  (−  = o'chirish)" : undefined}><Input name="paymeKey" type="password" autoComplete="new-password" placeholder={c.paymeKey ? "••••••" : ""} /></Field>
          <div className="pt-6"><Checkbox name="paymeTestMode" label={t("settings.paymeTestMode")} defaultChecked={c.paymeTestMode} /></div>
        </FormGrid>
        <div className="mt-4">
          <div className="mb-1 text-xs font-medium text-zinc-600">{t("settings.paymeFiscal")}</div>
          <p className="mb-2 text-xs text-zinc-500">{t("settings.paymeFiscalHint")}</p>
          <FormGrid cols={3}>
            <Field label={t("settings.paymeIkpu")}><Input name="fiscalIkpu" defaultValue={s.paymeFiscal?.ikpu ?? ""} inputMode="numeric" pattern="\d{17}" maxLength={17} autoComplete="off" /></Field>
            <Field label={t("settings.paymePackageCode")}><Input name="fiscalPackageCode" defaultValue={s.paymeFiscal?.packageCode ?? ""} maxLength={40} autoComplete="off" /></Field>
            <Field label={t("settings.paymeVat")}><Input name="fiscalVat" defaultValue={s.paymeFiscal ? String(s.paymeFiscal.vatPercent) : ""} inputMode="numeric" type="number" min={0} max={100} step={1} /></Field>
          </FormGrid>
        </div>
        <p className="mt-3 text-xs text-zinc-500">{t("settings.paymeEndpoint")}: <code className="rounded-sm bg-zinc-100 px-1 text-zinc-700">{appUrl}/api/payme</code></p>
      </Card>
      <Card title={t("settings.click")}>
        <p className="mb-3 text-sm text-zinc-500">{t("settings.clickHint")}</p>
        <FormGrid cols={3}>
          <Field label={t("settings.clickServiceId")}><Input name="clickServiceId" defaultValue={c.clickServiceId ?? ""} inputMode="numeric" autoComplete="off" /></Field>
          <Field label={t("settings.clickMerchantId")}><Input name="clickMerchantId" defaultValue={c.clickMerchantId ?? ""} inputMode="numeric" autoComplete="off" /></Field>
          <Field label={t("settings.clickSecretKey")} hint={c.clickSecretKey ? t("settings.secretKeep") : undefined}><Input name="clickSecretKey" type="password" autoComplete="new-password" placeholder={c.clickSecretKey ? "••••••" : ""} /></Field>
        </FormGrid>
        <p className="mt-3 text-xs text-zinc-500">{t("settings.clickEndpoints")}: <code className="rounded-sm bg-zinc-100 px-1 text-zinc-700">{appUrl}/api/click/prepare</code> · <code className="rounded-sm bg-zinc-100 px-1 text-zinc-700">{appUrl}/api/click/complete</code></p>
      </Card>
      <Card title={t("settings.uzum")}>
        <p className="mb-3 text-sm text-zinc-500">{t("settings.uzumHint")}</p>
        <FormGrid cols={3}>
          <Field label={t("settings.uzumServiceId")}><Input name="uzumServiceId" defaultValue={c.uzumServiceId ?? ""} inputMode="numeric" autoComplete="off" /></Field>
          <Field label={t("settings.uzumLogin")}><Input name="uzumLogin" defaultValue={c.uzumLogin ?? ""} autoComplete="off" /></Field>
          <Field label={t("settings.uzumPassword")} hint={c.uzumPassword ? t("settings.secretKeep") : undefined}><Input name="uzumPassword" type="password" autoComplete="new-password" placeholder={c.uzumPassword ? "••••••" : ""} /></Field>
        </FormGrid>
        <p className="mt-3 text-xs text-zinc-500">{t("settings.uzumEndpoint")}: <code className="rounded-sm bg-zinc-100 px-1 text-zinc-700">{appUrl}/api/uzum</code></p>
      </Card>
      <Card title={t("settings.sms")} actions={c.smsLogin && c.smsPassword ? <SubmitButton variant="secondary" size="sm" name="intent" value="smsTest">{t("settings.smsTest")}</SubmitButton> : undefined}>
        <p className="mb-3 text-sm text-zinc-500">{t("settings.smsHint")}</p>
        <FormGrid cols={3}>
          <Field label={t("settings.smsLogin")}><Input name="smsLogin" type="email" defaultValue={c.smsLogin ?? ""} autoComplete="off" /></Field>
          <Field label={t("settings.smsPassword")} hint={c.smsPassword ? t("settings.secretKeep") : undefined}><Input name="smsPassword" type="password" autoComplete="new-password" placeholder={c.smsPassword ? "••••••" : ""} /></Field>
          <Field label={t("settings.smsFrom")}><Input name="smsFrom" defaultValue={c.smsFrom ?? ""} placeholder="4546" maxLength={11} autoComplete="off" /></Field>
        </FormGrid>
        <div className="mt-4 mb-1 text-xs font-medium text-zinc-600">{t("settings.smsEvents")}</div>
        <div className="grid gap-2 sm:grid-cols-2">
          {SMS_EVENTS.map((k) => (
            <Checkbox key={k} name={`sms.${k}`} label={t(`settings.sms.${k}`)} defaultChecked={s.sms[k]} />
          ))}
        </div>
        <div className="mt-3"><Checkbox name="sms.onlyWithoutTelegram" label={t("settings.smsOnlyWithoutTelegram")} defaultChecked={s.sms.onlyWithoutTelegram} /></div>
      </Card>
      <div className="sticky bottom-4 z-10 flex justify-end rounded-xl border border-line bg-white/95 p-2 shadow-pop backdrop-blur-sm"><SubmitButton>{t("common.save")}</SubmitButton></div>
    </ActionForm>
  );
}
