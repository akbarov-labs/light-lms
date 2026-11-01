import type { TFn } from "@/lib/i18n";
import { SALARY_MODELS, type SalaryModel } from "@/lib/salary/models";

/** Translated labels for SalaryRuleFields (a client component gets strings, not the dictionary). */
export function salaryRuleLabels(t: TFn) {
  const per = (f: (m: SalaryModel) => string) => Object.fromEntries(SALARY_MODELS.map((m) => [m, f(m)])) as Record<SalaryModel, string>;
  return {
    model: t("salary.model"),
    percent: t("salary.percent"),
    fixedAmount: t("salary.fixedAmount"),
    perLesson: t("salary.perLesson"),
    models: per((m) => t(`salary.${m}`)),
    hints: per((m) => t(`salary.hint.${m}`)),
  };
}
