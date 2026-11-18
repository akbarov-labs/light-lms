// Homework on a lesson page (pilot): results of the homework due at this lesson, in question order with
// the questions everyone got right hidden by default, and the key editor for the homework set at it.
import Link from "next/link";
import type { TFn } from "@/lib/i18n";
import type { HomeworkView } from "@/lib/services/homework";
import { formatDate, formatDateTime } from "@/lib/dates";
import { Badge, Card } from "./ui";
import { Field, Textarea } from "./fields";
import { ActionForm, SubmitButton } from "./client";
import { deleteHomeworkAction, saveHomeworkAction } from "@/app/(admin)/lessons/homework-actions";

interface Props {
  t: TFn;
  lessonId: string;
  set: HomeworkView | null;
  due: HomeworkView | null;
  /** the teacher of the lesson or staff with groups.edit */
  canEdit: boolean;
  lessonCancelled: boolean;
  /** ?hw=all: also the questions everyone got right */
  showAll: boolean;
  /** this page's path, for the show-all toggle */
  path: string;
  directFromGrade: number;
}

export function HomeworkPanel({ t, lessonId, set, due, canEdit, lessonCancelled, showAll, path, directFromGrade }: Props) {
  return (
    <div className="space-y-4">
      {due && (
        <Card title={t("homework.dueHere")}>
          <HomeworkResults t={t} view={due} showAll={showAll} path={path} />
        </Card>
      )}
      {(set || (canEdit && !lessonCancelled)) && (
        <Card title={t("homework.setHere")}>
          {set && <HomeworkResults t={t} view={set} showAll={showAll} path={path} />}
          {canEdit && !lessonCancelled && (
            <div className={set ? "mt-5 border-t border-line pt-4" : ""}>
              <ActionForm action={saveHomeworkAction} className="space-y-3">
                <input type="hidden" name="lessonId" value={lessonId} />
                <Field label={t("homework.key")} hint={t("homework.keyHint")}>
                  <Textarea
                    name="key"
                    rows={set ? Math.min(12, Math.max(3, set.answers.length)) : 3}
                    required
                    placeholder={t("homework.keyPlaceholder")}
                    defaultValue={set ? set.answers.map((a, i) => `${i + 1}) ${a}`).join("\n") : ""}
                    className="font-mono"
                  />
                </Field>
                <Field label={t("homework.note")}>
                  <Textarea name="note" rows={2} maxLength={500} placeholder={t("homework.notePlaceholder")} defaultValue={set?.note ?? ""} />
                </Field>
                {!set && <p className="text-xs text-zinc-500">{t("homework.botHint", { grade: directFromGrade })}</p>}
                <SubmitButton>{set ? t("homework.save") : t("homework.create")}</SubmitButton>
              </ActionForm>
              {set && (
                <ActionForm action={deleteHomeworkAction} className="mt-2">
                  <input type="hidden" name="homeworkId" value={set.id} />
                  <SubmitButton variant="secondary" size="sm" confirm={t("homework.deleteConfirm")}>{t("homework.delete")}</SubmitButton>
                </ActionForm>
              )}
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function windowText(t: TFn, v: HomeworkView): string {
  const from = formatDateTime(v.window.opensAt);
  const to = v.window.dueAt ? formatDateTime(v.window.dueAt) : "";
  if (v.state === "closed") return t("homework.closed", { to });
  return v.window.dueAt ? t("homework.windowOpen", { from, to }) : t("homework.windowNoEnd", { from });
}

export function HomeworkResults({ t, view, showAll, path }: { t: TFn; view: HomeworkView; showAll: boolean; path: string }) {
  const { report } = view;
  const name = new Map(view.students.map((s) => [s.studentId, s.name]));
  const names = (ids: string[]) => ids.map((id) => name.get(id) ?? "?").join(", ");
  const answered = new Set(report.answeredBy);
  const missing = view.students.filter((s) => !answered.has(s.studentId));
  const hidden = showAll ? [] : report.questions.filter((q) => q.allCorrect);
  const shown = report.questions.filter((q) => showAll || !q.allCorrect);
  const total = view.answers.length;
  return (
    <div className="space-y-4 text-sm">
      <div className="flex flex-wrap items-center gap-2 text-zinc-600">
        <span>{t("homework.fromLesson", { date: formatDate(view.lessonDate) })}</span>
        <span aria-hidden>·</span>
        <span>{t("homework.questions", { n: total })}</span>
        <Badge tone={report.answeredBy.length ? "blue" : "gray"}>{t("homework.answered", { n: report.answeredBy.length, total: view.students.length })}</Badge>
      </div>
      <p className="text-xs text-zinc-500">{windowText(t, view)}</p>
      {view.note && <p className="whitespace-pre-line rounded-lg bg-zinc-50 px-3 py-2 text-zinc-700">{view.note}</p>}

      {report.answeredBy.length === 0 ? (
        <p className="text-zinc-500">{t("homework.noAnswers")}</p>
      ) : (
        <>
          {shown.length === 0 ? (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800">{t("homework.allQuestionsCorrect")}</p>
          ) : (
            <ol className="divide-y divide-line rounded-lg border border-line">
              {shown.map((q) => (
                <li key={q.n} className="px-3 py-2.5">
                  <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <span className="font-medium text-zinc-900">{t("homework.question", { n: q.n })}</span>
                    <span className="text-zinc-500">
                      {t("homework.keyLabel")}: <span className="font-mono font-semibold text-zinc-900">{q.key.split("|").join(" / ")}</span>
                    </span>
                    <span className={q.allCorrect ? "text-emerald-700" : q.correct * 2 < q.of ? "font-medium text-red-700" : "text-amber-700"}>
                      {t("homework.correctOf", { c: q.correct, n: q.of })}
                    </span>
                  </div>
                  {(q.wrong.length > 0 || q.blank.length > 0) && (
                    <ul className="mt-1.5 space-y-0.5 text-zinc-600">
                      {q.wrong.map((w) => (
                        <li key={w.given}>
                          <span className="font-mono text-red-700">{w.given}</span> <span className="text-zinc-400">({t("homework.wrong")}, {w.studentIds.length})</span> — {names(w.studentIds)}
                        </li>
                      ))}
                      {q.blank.length > 0 && (
                        <li>
                          <span className="text-zinc-400">{t("homework.blank")}</span> — {names(q.blank)}
                        </li>
                      )}
                    </ul>
                  )}
                </li>
              ))}
            </ol>
          )}
          {(hidden.length > 0 || showAll) && (
            <p className="text-xs text-zinc-500">
              {hidden.length > 0 && <>{t("homework.allCorrectHidden", { n: hidden.length })} </>}
              <Link href={showAll ? path : `${path}?hw=all`} className="font-medium text-zinc-700 underline decoration-zinc-300 hover:decoration-zinc-500" scroll={false}>
                {showAll ? t("homework.hideAllCorrect") : t("homework.showAll")}
              </Link>
            </p>
          )}
          <div>
            <div className="mb-1.5 text-xs font-medium text-zinc-600">{t("homework.scores")}</div>
            <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
              {view.students
                .filter((s) => answered.has(s.studentId))
                .map((s) => ({ ...s, score: report.scores.get(s.studentId)! }))
                .sort((a, b) => b.score.correct - a.score.correct || a.name.localeCompare(b.name))
                .map((s) => (
                  <li key={s.studentId} className="flex justify-between gap-3 border-b border-dashed border-line py-0.5">
                    <span className="truncate">{s.name}</span>
                    <span className="shrink-0 font-mono tabular-nums">
                      {s.score.correct}/{total}
                    </span>
                  </li>
                ))}
            </ul>
          </div>
        </>
      )}
      {missing.length > 0 && (
        <p className="text-zinc-600">
          <span className="text-xs font-medium text-zinc-600">{t("homework.notAnswered")}:</span> {missing.map((s) => s.name).join(", ")}
        </p>
      )}
    </div>
  );
}
