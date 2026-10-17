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
    })
    // prefault: {} is parsed, so every nested default applies (zod 4 .default() would return {} as is)
    .prefault({}),
  // a broken value must not reset every other setting to its default
  paymeFiscal: paymeFiscalSchema.nullable().default(null).catch(null),
});

export type CenterSettings = z.infer<typeof centerSettingsSchema>;

export function readSettings(raw: unknown): CenterSettings {
  const parsed = centerSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : centerSettingsSchema.parse({});
}
