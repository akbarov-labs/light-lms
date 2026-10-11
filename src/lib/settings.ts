import { z } from "zod";

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
    .default({}),
});

export type CenterSettings = z.infer<typeof centerSettingsSchema>;

export function readSettings(raw: unknown): CenterSettings {
  const parsed = centerSettingsSchema.safeParse(raw ?? {});
  return parsed.success ? parsed.data : centerSettingsSchema.parse({});
}
