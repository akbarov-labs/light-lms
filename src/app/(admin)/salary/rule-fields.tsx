"use client";

import { useState } from "react";
import { Field, FormGrid, Input, Select } from "@/components/fields";
import { MODEL_FIELDS, SALARY_MODELS, type SalaryModel } from "@/lib/salary/models";

/**
 * The salary method and only the amounts it uses (a fixed salary has no percent field, and so on), with
 * one plain line on how it pays. Shared by the salary page and the setup wizard's teacher step.
 * `labels` are translated on the server: model names, field labels and one hint per model.
 */
export function SalaryRuleFields({
  labels,
  defaults,
  children,
}: {
  labels: { model: string; percent: string; fixedAmount: string; perLesson: string; models: Record<SalaryModel, string>; hints: Record<SalaryModel, string> };
  defaults?: { model?: SalaryModel; percent?: number | null; fixedAmount?: number | null; perLesson?: number | null };
  /** extra fields in the same grid, e.g. "valid from" */
  children?: React.ReactNode;
}) {
  const [model, setModel] = useState<SalaryModel>(defaults?.model ?? "PERCENT_EARNED");
  const uses = MODEL_FIELDS[model];
  return (
    <>
      <Field label={labels.model}>
        <Select name="model" value={model} onChange={(e) => setModel(e.target.value as SalaryModel)}>
          {SALARY_MODELS.map((m) => <option key={m} value={m}>{labels.models[m]}</option>)}
        </Select>
        <span className="mt-1 block text-xs text-zinc-500">{labels.hints[model]}</span>
      </Field>
      <FormGrid>
        {uses.includes("fixedAmount") && (
          <Field label={labels.fixedAmount}><Input name="fixedAmount" inputMode="numeric" required defaultValue={defaults?.fixedAmount ?? ""} placeholder="3 000 000" /></Field>
        )}
        {uses.includes("percent") && (
          <Field label={labels.percent}><Input name="percent" type="number" min={0} max={100} required defaultValue={defaults?.percent ?? 40} /></Field>
        )}
        {uses.includes("perLesson") && (
          <Field label={labels.perLesson}><Input name="perLesson" inputMode="numeric" required defaultValue={defaults?.perLesson ?? ""} placeholder="80 000" /></Field>
        )}
        {children}
      </FormGrid>
    </>
  );
}
