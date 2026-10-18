// Results of one exam: a row per participant (group roster + anyone added), section or total scores.
import type { TFn } from "@/lib/i18n";
import type { Section } from "@/lib/academics/exams";
import { saveExamResultsAction } from "@/app/(admin)/exams/actions";
import { ActionForm, SubmitButton } from "./client";
import { Badge, Card, EmptyState } from "./ui";

export interface ResultBoardRow {
  key: string; // "s:<studentId>" | "l:<leadId>"
  name: string;
  isLead: boolean;
  score: number | null;
  sectionScores: number[];
  passed: boolean | null;
  level: string | null;
  comment: string | null;
  certified: boolean;
}

const num = "h-9 w-20 rounded-lg border border-zinc-300 bg-white px-2 text-right text-sm tnum";

export function ExamResultsBoard({ examId, rows, sections, maxScore, t, locked }: { examId: string; rows: ResultBoardRow[]; sections: Section[]; maxScore: number; t: TFn; locked?: boolean }) {
  if (rows.length === 0) return <Card><EmptyState compact>{t("exams.noParticipants")}</EmptyState></Card>;
  return (
    <ActionForm action={saveExamResultsAction} className="space-y-3">
      <input type="hidden" name="examId" value={examId} />
      <Card pad={false}>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-zinc-100 text-left text-xs text-zinc-500">
                <th className="px-4 py-2 font-medium">{t("exams.participant")}</th>
                {sections.length > 0 ? sections.map((s, i) => <th key={i} className="px-2 py-2 text-right font-medium">{s.name} <span className="text-zinc-400">/{s.max}</span></th>) : <th className="px-2 py-2 text-right font-medium">{t("exams.score")} <span className="text-zinc-400">/{maxScore}</span></th>}
                {sections.length > 0 && <th className="px-2 py-2 text-right font-medium">{t("exams.total")}</th>}
                <th className="px-2 py-2 font-medium">{t("exams.comment")}</th>
                <th className="px-4 py-2" />
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-100">
              {rows.map((r) => (
                <tr key={r.key}>
                  <td className="px-4 py-2">
                    {r.name}
                    {r.isLead && <span className="ml-1 text-xs text-zinc-500">({t("exams.leadTag")})</span>}
                  </td>
                  {sections.length > 0 ? (
                    sections.map((s, i) => (
                      <td key={i} className="px-2 py-2 text-right">
                        <input name={`${r.key}:sec:${i}`} defaultValue={r.sectionScores[i] ?? ""} inputMode="numeric" aria-label={`${r.name}: ${s.name}`} className={num} disabled={locked} />
                      </td>
                    ))
                  ) : (
                    <td className="px-2 py-2 text-right">
                      <input name={`${r.key}:total`} defaultValue={r.score ?? ""} inputMode="numeric" aria-label={`${r.name}: ${t("exams.score")}`} className={num} disabled={locked} />
                    </td>
                  )}
                  {sections.length > 0 && <td className="tnum px-2 py-2 text-right font-medium">{r.score ?? "—"}</td>}
                  <td className="px-2 py-2">
                    <input name={`${r.key}:comment`} defaultValue={r.comment ?? ""} maxLength={500} aria-label={`${r.name}: ${t("exams.comment")}`} className="h-9 w-full min-w-40 rounded-lg border border-zinc-300 bg-white px-2 text-sm" disabled={locked} />
                  </td>
                  <td className="whitespace-nowrap px-4 py-2 text-right">
                    {r.level && <Badge tone="blue" dot={false}>{r.level}</Badge>}{" "}
                    {r.passed !== null && <Badge tone={r.passed ? "green" : "red"}>{r.passed ? t("exams.passed") : t("exams.failed")}</Badge>}
                    {r.certified && <> <Badge tone="violet" dot={false}>{t("cert.title")}</Badge></>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
      {!locked && <div className="flex justify-end"><SubmitButton>{t("exams.saveResults")}</SubmitButton></div>}
    </ActionForm>
  );
}
