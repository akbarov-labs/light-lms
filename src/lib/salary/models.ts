// Salary models and which amounts each uses. No imports, so the rule form can use it in the browser.

export type SalaryModel = "PERCENT_EARNED" | "FIXED" | "PER_LESSON" | "BASE_PLUS_PERCENT";

export const SALARY_MODELS: readonly SalaryModel[] = ["PERCENT_EARNED", "FIXED", "PER_LESSON", "BASE_PLUS_PERCENT"];

/** Which amounts a model uses; the rule form shows only these fields. */
export const MODEL_FIELDS: Record<SalaryModel, readonly ("percent" | "fixedAmount" | "perLesson")[]> = {
  PERCENT_EARNED: ["percent"],
  FIXED: ["fixedAmount"],
  PER_LESSON: ["perLesson"],
  BASE_PLUS_PERCENT: ["fixedAmount", "percent"],
};

/** A rule as stored: the model's own amounts (missing = 0), every other amount null. */
export function normalizeRule(model: SalaryModel, input: { percent?: number; fixedAmount?: number; perLesson?: number }): { model: SalaryModel; percent: number | null; fixedAmount: number | null; perLesson: number | null } {
  const uses = MODEL_FIELDS[model];
  return {
    model,
    percent: uses.includes("percent") ? (input.percent ?? 0) : null,
    fixedAmount: uses.includes("fixedAmount") ? (input.fixedAmount ?? 0) : null,
    perLesson: uses.includes("perLesson") ? (input.perLesson ?? 0) : null,
  };
}
