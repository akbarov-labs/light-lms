import { z } from "zod";

/**
 * Payme fiscal receipt data (OFD): IKPU (MXIK) code of the service, its package code and VAT %.
 * When set, CheckPerformTransaction returns `detail` so Payme prints a fiscal receipt.
 */
export const paymeFiscalSchema = z.object({
  ikpu: z.string().regex(/^\d{17}$/),
  packageCode: z.string().trim().min(1).max(40),
  vatPercent: z.number().int().min(0).max(100),
});
export type PaymeFiscal = z.infer<typeof paymeFiscalSchema>;

// Center-level settings stored in Center.settings (JSON). Defaults per HANDOFF §6.
export const centerSettingsSchema = z.object({
  trialLessons: z.number().int().min(0).max(10).default(1),
  excusedAbsenceCredit: z.boolean().default(false),
  payTeacherForTrial: z.boolean().default(false),
  payFromCollected: z.boolean().default(false),
  gradeScale: z.enum(["5", "100"]).default("5"),
  reminderDaysBefore: z.number().int().min(0).max(15).default(3),
  lessonsAheadDays: z.number().int().min(31).max(180).default(60),
  transferAsTrial: z.boolean().default(false),
  expenseCategories: z
    .array(z.string().min(1).max(60))
    .max(50)
    .default(["Ijara / Rent", "Kommunal / Utilities", "Reklama / Ads", "Oylik / Salary", "Jihozlar / Equipment", "Ofis / Office", "Boshqa / Other"]),
  notify: z
    .object({
      payment: z.boolean().default(true),
      reminder: z.boolean().default(true),
      debt: z.boolean().default(true),
      absence: z.boolean().default(true),
      trial: z.boolean().default(true),
      teacherReminder: z.boolean().default(true),
      dailyReport: z.boolean().default(true),
      reportCard: z.boolean().default(true),
      examResult: z.boolean().default(true),
    })
    // prefault: {} is parsed, so every nested default applies (zod 4 .default() would return {} as is)
    .prefault({}),
  // a broken value must not reset every other setting to its default
  paymeFiscal: paymeFiscalSchema.nullable().default(null).catch(null),
  /** Report cards (v2): send last month's cards to parents automatically on this day of the month, 11:00. */
  reportCards: z
    .object({ autoSend: z.boolean().default(false), sendDay: z.number().int().min(1).max(28).default(3) })
    .prefault({})
    .catch(() => ({ autoSend: false, sendDay: 3 })),
  /** SMS (v2): which family messages also go out as SMS. Needs the center's Eskiz login (Center.sms*). */
  sms: z
    .object({
      payment: z.boolean().default(false),
      reminder: z.boolean().default(true),
      debt: z.boolean().default(true),
      absence: z.boolean().default(false),
      trial: z.boolean().default(true),
      reportCard: z.boolean().default(false),
      examResult: z.boolean().default(false),
      /** true = only families with no linked Telegram chat get the SMS (they already got the message) */
      onlyWithoutTelegram: z.boolean().default(true),
    })
    .prefault({})
    .catch(() => smsDefaults()),
  /**
   * AI lead agent (phase 1). Off by default: conversations go to an external API (Anthropic), and
   * real centers' personal data must stay in Uzbekistan (DEPLOY.md §0) until that is settled.
   */
  agent: z
    .object({
      enabled: z.boolean().default(false),
      /** The center's own rules in plain language (discounts, installments, refunds...), added to the agent's prompt. */
      rules: z.string().max(4000).default(""),
      /** Input + output tokens per calendar month; above it the agent stops answering until next month. */
      monthlyTokenCap: z.number().int().min(0).max(100_000_000).default(5_000_000),
    })
    .prefault({})
    .catch(() => ({ enabled: false, rules: "", monthlyTokenCap: 5_000_000 })),
  /**
   * Homework (pilot, HANDOFF §2 lists it as a bet to validate): the teacher's answer key per lesson,
   * students answer in the bot, code grades. Off by default: most centers use Telegram groups for it.
   */
  homework: z
    .object({
      enabled: z.boolean().default(false),
      /** school grade from which the student hears about homework directly; below it the parents do */
      directFromGrade: z.number().int().min(1).max(12).default(9),
    })
    .prefault({})
    .catch(() => ({ enabled: false, directFromGrade: 9 })),
});

export type CenterSettings = z.infer<typeof centerSettingsSchema>;
export type SmsEvent = Exclude<keyof CenterSettings["sms"], "onlyWithoutTelegram">;
export const SMS_EVENTS: SmsEvent[] = ["payment", "reminder", "debt", "absence", "trial", "reportCard", "examResult"];

function smsDefaults() {
  return { payment: false, reminder: true, debt: true, absence: false, trial: true, reportCard: false, examResult: false, onlyWithoutTelegram: true };
}

export function readSettings(raw: unknown): CenterSettings {
  const parsed = centerSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : centerSettingsSchema.parse({});
}
