import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/ctx";
import { UserError } from "@/lib/user-error";
import { formatDateTime } from "@/lib/dates";
import { LETTERS } from "@/lib/questions/keys";
import { quizDetail } from "@/lib/services/quizzes";
import { Badge, Card, cx, EmptyState, PageHeader, Table, Td, Th, Tr, type Tone } from "@/components/ui";
import { Field, Input } from "@/components/fields";
import { ActionForm, Modal, ModalForm, SubmitButton } from "@/components/client";
import { closeQuizAction, deleteQuizAction, publishQuizAction, removeQuestionAction, replaceQuestionAction, sendParentsAction, updateQuizAction } from "../actions";
import { MAX_MINUTES } from "@/lib/quizzes/timing";

const STATUS_TONE: Record<string, Tone> = { DRAFT: "gray", PUBLISHED: "green", CLOSED: "violet" };
const STATE_TONE: Record<string, Tone> = { notStarted: "gray", open: "amber", expired: "amber", submitted: "green" };

export default async function QuizPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireStaff("groups.edit");
  const { t } = ctx;
  const data = await quizDetail(ctx, id).catch((e) => {
    if (e instanceof UserError) notFound();
    throw e;
  });
  const { quiz, questions, results, wrongCount } = data;
  const draft = quiz.status === "DRAFT";
  const ownerish = ctx.role === "OWNER" || ctx.role === "MANAGER";
  const finished = results.filter((r) => r.state === "submitted").length;

  return (
    <>
      <PageHeader
        back={{ href: "/quizzes", label: t("nav.quizzes") }}
        title={quiz.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={STATUS_TONE[quiz.status]}>{t(`quizzes.status.${quiz.status}`)}</Badge>
            {quiz.group && <Link href={`/groups/${quiz.group.id}`} className="text-sm text-zinc-600 hover:underline">{quiz.group.name}</Link>}
            <span className="text-sm tabular-nums text-zinc-500">{t("quizzes.meta", { n: questions.length, m: quiz.minutes })}</span>
          </span>
        }
        actions={
          <>
            {draft && (
              <>
                <Modal label={t("quizzes.edit")} title={t("quizzes.edit")} variant="secondary" size="sm">
                  <ModalForm action={updateQuizAction} className="space-y-3">
                    <input type="hidden" name="quizId" value={quiz.id} />
                    <Field label={t("quizzes.titleField")}><Input name="title" defaultValue={quiz.title} maxLength={200} required /></Field>
                    <Field label={t("quizzes.minutes")}><Input name="minutes" type="number" min={1} max={MAX_MINUTES} defaultValue={quiz.minutes} required /></Field>
                    <SubmitButton>{t("common.save")}</SubmitButton>
                  </ModalForm>
                </Modal>
                <ActionForm action={deleteQuizAction}>
                  <input type="hidden" name="quizId" value={quiz.id} />
                  <SubmitButton variant="secondary" confirm={t("quizzes.deleteConfirm")}>{t("quizzes.delete")}</SubmitButton>
                </ActionForm>
                <ActionForm action={publishQuizAction}>
                  <input type="hidden" name="quizId" value={quiz.id} />
                  <SubmitButton confirm={t("quizzes.publishConfirm")}>{t("quizzes.publish")}</SubmitButton>
                </ActionForm>
              </>
            )}
            {quiz.status === "PUBLISHED" && (
              <ActionForm action={closeQuizAction}>
                <input type="hidden" name="quizId" value={quiz.id} />
                <SubmitButton variant="secondary" confirm={t("quizzes.closeConfirm")}>{t("quizzes.close")}</SubmitButton>
              </ActionForm>
            )}
          </>
        }
      />

      {draft ? (
        <p className="mb-4 max-w-3xl text-sm text-zinc-600">{t("quizzes.draftHint")}</p>
      ) : (
        <Card
          className="mb-4"
          pad={false}
          title={`${t("quizzes.results")} · ${finished}/${results.length}`}
          actions={
            ownerish ? (
              <ActionForm action={sendParentsAction}>
                <input type="hidden" name="quizId" value={quiz.id} />
                <SubmitButton variant="secondary" size="sm" confirm={t("quizzes.sendParentsConfirm")}>{t("quizzes.sendParents")}</SubmitButton>
              </ActionForm>
            ) : (
              <span className="text-xs text-zinc-500">{t("quizzes.ownerOnlyHint")}</span>
            )
          }
        >
          <p className="border-b border-line px-4 py-3 text-xs text-zinc-500">
            {t("quizzes.resultsHint")}
            {quiz.parentsSentAt && <> · {t("quizzes.parentsSentAt", { at: formatDateTime(quiz.parentsSentAt) })}</>}
          </p>
          {results.length === 0 ? (
            <EmptyState compact>{t("common.empty")}</EmptyState>
          ) : (
            <Table>
              <thead>
                <tr>
                  <Th>{t("quizzes.col.student")}</Th>
                  <Th>{t("quizzes.col.status")}</Th>
                  <Th className="text-right">{t("quizzes.col.score")}</Th>
                  <Th className="text-right">{t("quizzes.col.time")}</Th>
                  <Th>{t("quizzes.col.wrong")}</Th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <Tr key={r.studentId} muted={r.state === "notStarted"}>
                    <Td className="whitespace-nowrap"><Link href={`/students/${r.studentId}`} className="font-medium hover:underline">{r.name}</Link></Td>
                    <Td>
                      <Badge tone={STATE_TONE[r.state]}>{t(`quizzes.state.${r.state}`)}</Badge>
                      {r.auto && r.state === "submitted" && <span className="ml-1 text-xs text-zinc-500">{t("quizzes.auto")}</span>}
                    </Td>
                    <Td className="text-right tabular-nums font-medium">{r.correct === null ? "—" : `${r.correct}/${r.total} · ${r.percent}%`}</Td>
                    <Td className="text-right tabular-nums text-zinc-600">{r.minutes === null ? "—" : t("quizzes.minutesShort", { n: r.minutes })}</Td>
                    <Td className="text-sm tabular-nums text-zinc-700">{r.state !== "submitted" ? "" : r.wrong.length ? r.wrong.join(", ") : <span className="text-emerald-700">{t("quizzes.allRight")}</span>}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      )}

      <div className="space-y-3">
        {questions.map((q, i) => (
          <Card key={`${q.id}:${i}`}>
            <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
              <span className="font-semibold tabular-nums text-zinc-800">{i + 1}.</span>
              <span className="tabular-nums">{q.topic.code}{q.number !== null ? ` · ${t("questions.number", { n: q.number })}` : ""}</span>
              {q.status !== "APPROVED" && <Badge tone="red">{t(`questions.status.${q.status}`)}</Badge>}
              {!draft && wrongCount[i] > 0 && <Badge tone="amber">{t("quizzes.wrongBy", { n: wrongCount[i] })}</Badge>}
            </div>
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-zinc-900">{q.text}</p>
            {q.options.length > 0 && (
              <ol className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                {q.options.map((o, k) => (
                  <li key={k} className={cx("rounded px-2 py-0.5", q.answer === LETTERS[k] && "bg-emerald-50 font-medium text-emerald-900")}>{LETTERS[k]}) {o}</li>
                ))}
              </ol>
            )}
            <p className="mt-3 text-sm">
              <span className="text-zinc-500">{t("quizzes.key")}: </span>
              <span className="font-semibold">{q.answer || "—"}</span>
            </p>
            {draft && (
              <div className="mt-3 flex flex-wrap gap-2 border-t border-zinc-100 pt-3">
                <QuestionButton action={replaceQuestionAction} quizId={quiz.id} questionId={q.id} label={t("quizzes.replace")} />
                {questions.length > 1 && <QuestionButton action={removeQuestionAction} quizId={quiz.id} questionId={q.id} label={t("quizzes.remove")} />}
              </div>
            )}
          </Card>
        ))}
      </div>
    </>
  );
}

function QuestionButton({ action, quizId, questionId, label }: { action: typeof removeQuestionAction; quizId: string; questionId: string; label: string }) {
  return (
    <ActionForm action={action}>
      <input type="hidden" name="quizId" value={quizId} />
      <input type="hidden" name="questionId" value={questionId} />
      <SubmitButton variant="secondary" size="sm">{label}</SubmitButton>
    </ActionForm>
  );
}
