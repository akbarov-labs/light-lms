import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/ctx";
import { approvable, LETTERS } from "@/lib/questions/keys";
import { FILTERS, topicQuestions, type QuestionFilter } from "@/lib/services/questions";
import { Badge, Card, cx, EmptyState, PageHeader, type Tone } from "@/components/ui";
import { Field, Input, Textarea } from "@/components/fields";
import { ActionForm, Modal, ModalForm, SubmitButton } from "@/components/client";
import { MathText } from "@/components/math-text";
import { approveSureAction, editQuestionAction, editTheoryAction, setQuestionStatusAction } from "../actions";
import { MAX_THEORY } from "@/lib/questions/extract";

const KEY_TONE: Record<string, Tone> = { STATED: "green", AGREED: "green", CONFLICT: "red", UNKNOWN: "amber" };
const STATUS_TONE: Record<string, Tone> = { DRAFT: "gray", APPROVED: "green", REJECTED: "red" };

export default async function TopicQuestionsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const [{ id }, sp] = await Promise.all([params, searchParams]);
  const ctx = await requireStaff();
  const { t } = ctx;
  const asked = FILTERS.find((f) => f === sp.f);
  const first = await topicQuestions(ctx.centerId, id, asked ?? "check");
  if (!first) notFound();
  // nothing left to check: open on what is waiting next
  const filter: QuestionFilter = asked ?? (first.counts.check ? "check" : first.counts.sure ? "sure" : "all");
  const data = filter === (asked ?? "check") ? first : (await topicQuestions(ctx.centerId, id, filter))!;
  const { topic, questions, counts, subtopics, more } = data;
  const canEdit = ctx.can("groups.edit");

  return (
    <>
      <PageHeader
        back={{ href: "/questions", label: t("nav.questions") }}
        title={`${topic.code}. ${topic.title}`}
        docTitle={topic.title}
        actions={
          canEdit &&
          counts.sure > 0 && (
            <ActionForm action={approveSureAction}>
              <input type="hidden" name="topicId" value={topic.id} />
              <SubmitButton confirm={t("questions.approveSureConfirm", { n: counts.sure })}>{t("questions.approveSure", { n: counts.sure })}</SubmitButton>
            </ActionForm>
          )
        }
      />
      {subtopics.length > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2 text-sm">
          <span className="text-zinc-500">{t("questions.subtopics")}:</span>
          {subtopics.map((s) => (
            <Link key={s.id} href={`/questions/${s.id}`} className="rounded-full border border-line bg-white px-3 py-1 hover:bg-zinc-50">
              <span className="tabular-nums text-zinc-500">{s.code}.</span> {s.title}
            </Link>
          ))}
        </div>
      )}
      {(topic.theory || canEdit) && (
        <details className="mb-4 rounded-xl border border-line bg-white" open={!!topic.theory && counts.all < 1}>
          <summary className="cursor-pointer px-4 py-3 text-sm font-medium text-zinc-900">
            {t("questions.theory")}
            {!topic.theory && <span className="ml-2 font-normal text-zinc-500">{t("questions.theoryNone")}</span>}
          </summary>
          <div className="border-t border-zinc-100 px-4 py-3">
            {topic.theory && <div className="whitespace-pre-wrap text-[15px] leading-relaxed text-zinc-800"><MathText text={topic.theory} /></div>}
            {canEdit && (
              <div className="mt-3">
                <Modal label={t("questions.theoryEdit")} title={`${t("questions.theoryEdit")}: ${topic.code}. ${topic.title}`} variant="secondary" size="sm" wide>
                  <ModalForm action={editTheoryAction} className="space-y-3">
                    <input type="hidden" name="topicId" value={topic.id} />
                    <Field label={t("questions.theory")} hint={t("questions.mathHint")}>
                      <Textarea name="theory" defaultValue={topic.theory ?? ""} rows={14} maxLength={MAX_THEORY} />
                    </Field>
                    <SubmitButton>{t("common.save")}</SubmitButton>
                  </ModalForm>
                </Modal>
              </div>
            )}
          </div>
        </details>
      )}
      <nav className="mb-4 flex flex-wrap gap-1" aria-label={t("common.filter")}>
        {FILTERS.map((f) => (
          <Link
            key={f}
            href={`/questions/${topic.id}?f=${f}`}
            aria-current={f === filter ? "page" : undefined}
            className={cx("rounded-lg px-3 py-1.5 text-sm", f === filter ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100")}
          >
            {t(`questions.f.${f}`)} <span className="tabular-nums opacity-70">{counts[f]}</span>
          </Link>
        ))}
      </nav>
      {questions.length === 0 ? (
        <Card>
          <EmptyState compact>{t("questions.noneHere")}</EmptyState>
        </Card>
      ) : (
        <div className="space-y-3">
          {questions.map((q) => {
            const solves = q.solves.map((s) => s || "?").join(" · ");
            return (
              <Card key={q.id}>
                <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-zinc-500">
                  <span className="font-medium text-zinc-800">
                    {q.topic.code !== topic.code && <span className="tabular-nums">{q.topic.code} · </span>}
                    {q.number !== null && t("questions.number", { n: q.number })}
                  </span>
                  {q.sourceRef && <span className="tabular-nums">({q.sourceRef})</span>}
                  {q.page !== null && <span>{t("questions.page", { n: q.page })}</span>}
                  <Badge tone={STATUS_TONE[q.status]}>{t(`questions.status.${q.status}`)}</Badge>
                  {q.status === "DRAFT" && <Badge tone={KEY_TONE[q.keyCheck]}>{t(`questions.key.${q.keyCheck}`)}</Badge>}
                  {q.needsFigure && <Badge tone="violet">{t("questions.figure")}</Badge>}
                </div>
                <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-zinc-900"><MathText text={q.text} /></p>
                {q.options.length > 0 && (
                  <ol className="mt-2 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
                    {q.options.map((o, i) => (
                      <li key={i} className={cx("rounded px-2 py-0.5", q.answer === LETTERS[i] && "bg-emerald-50 font-medium text-emerald-900")}>
                        {LETTERS[i]}) <MathText text={o} />
                      </li>
                    ))}
                  </ol>
                )}
                <p className="mt-3 text-sm">
                  <span className="text-zinc-500">{t("questions.keyLabel")}: </span>
                  <span className={cx("font-semibold", q.answer ? "text-zinc-900" : "text-amber-700")}>{q.answer || t("questions.noKey")}</span>
                  <span className="ml-3 text-xs text-zinc-500">
                    {q.statedAnswer && <>{t("questions.fromBook", { v: q.statedAnswer })} · </>}
                    {t("questions.solves", { v: solves || "—" })}
                  </span>
                </p>
                {q.solution && (
                  <details className="mt-2 text-sm">
                    <summary className="cursor-pointer text-zinc-500">{t("questions.solution")}</summary>
                    <p className="mt-1 whitespace-pre-wrap text-zinc-700"><MathText text={q.solution} /></p>
                  </details>
                )}
                {canEdit && (
                  <div className="mt-3 flex flex-wrap items-start gap-2 border-t border-zinc-100 pt-3">
                    {q.status !== "APPROVED" && approvable(q) && (
                      <StatusButton id={q.id} topicId={topic.id} status="APPROVED" label={t("questions.approve")} />
                    )}
                    {q.status !== "REJECTED" && <StatusButton id={q.id} topicId={topic.id} status="REJECTED" label={t("questions.reject")} variant="secondary" />}
                    {q.status !== "DRAFT" && <StatusButton id={q.id} topicId={topic.id} status="DRAFT" label={t("questions.toDraft")} variant="secondary" />}
                    <Modal label={t("questions.edit")} title={`${t("questions.edit")}: ${q.number !== null ? t("questions.number", { n: q.number }) : ""}`} variant="secondary" size="sm" wide>
                      <ModalForm action={editQuestionAction} className="space-y-3">
                        <input type="hidden" name="id" value={q.id} />
                        <input type="hidden" name="topicId" value={topic.id} />
                        <Field label={t("questions.text")} hint={t("questions.mathHint")}>
                          <Textarea name="text" defaultValue={q.text} rows={5} required maxLength={4000} />
                        </Field>
                        <Field label={t("questions.options")} hint={t("questions.optionsHint")}>
                          <Textarea name="options" defaultValue={q.options.join("\n")} rows={5} maxLength={3000} />
                        </Field>
                        <Field label={t("questions.answer")} hint={t("questions.answerHint")}>
                          <Input name="answer" defaultValue={q.answer} maxLength={100} />
                        </Field>
                        <SubmitButton>{t("common.save")}</SubmitButton>
                      </ModalForm>
                    </Modal>
                  </div>
                )}
              </Card>
            );
          })}
          {more > 0 && <p className="text-sm text-zinc-500">{t("questions.more", { n: more })}</p>}
        </div>
      )}
    </>
  );
}

function StatusButton({ id, topicId, status, label, variant = "primary" }: { id: string; topicId: string; status: string; label: string; variant?: "primary" | "secondary" }) {
  return (
    <ActionForm action={setQuestionStatusAction}>
      <input type="hidden" name="id" value={id} />
      <input type="hidden" name="topicId" value={topicId} />
      <input type="hidden" name="status" value={status} />
      <SubmitButton variant={variant} size="sm">{label}</SubmitButton>
    </ActionForm>
  );
}
