import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff, studentScope } from "@/lib/ctx";
import { db } from "@/lib/db";
import { formatDate, formatDateTime, toISODate } from "@/lib/dates";
import { fullName } from "@/lib/format";
import { examStats } from "@/lib/academics/exams";
import { bandsOf, examFor, examRoster, sectionsOf } from "@/lib/services/exams";
import { UserError } from "@/lib/user-error";
import { Badge, Card, KV, LinkButton, PageHeader } from "@/components/ui";
import { Field, FormGrid, Input, Select } from "@/components/fields";
import { ActionForm, Modal, ModalForm, SubmitButton } from "@/components/client";
import { ExamResultsBoard, type ResultBoardRow } from "@/components/exam-results-board";
import { addParticipantAction, issueCertificatesAction, publishExamAction } from "../actions";

export default async function ExamPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireStaff();
  const { t } = ctx;
  const exam = await examFor({ userId: ctx.userId, centerId: ctx.centerId, canEdit: true, branchIds: ctx.branchIds }, id).catch((e: unknown) => {
    if (e instanceof UserError) notFound();
    throw e;
  });
  const canEdit = ctx.can("groups.edit");
  const sections = sectionsOf(exam.sections);
  const bands = bandsOf(exam.levelBands);
  const [roster, results] = await Promise.all([
    examRoster(exam),
    db.examResult.findMany({ where: { examId: id }, include: { student: { select: { firstName: true, lastName: true } }, lead: { select: { name: true } }, certificate: { select: { id: true } } } }),
  ]);
  const byKey = new Map(results.map((r) => [r.studentId ? `s:${r.studentId}` : `l:${r.leadId}`, r]));
  const rows: ResultBoardRow[] = [];
  const seen = new Set<string>();
  const push = (key: string, name: string, isLead: boolean) => {
    if (seen.has(key)) return;
    seen.add(key);
    const r = byKey.get(key);
    rows.push({ key, name, isLead, score: r?.score ?? null, sectionScores: Array.isArray(r?.sectionScores) ? (r!.sectionScores as number[]) : [], passed: r?.passed ?? null, level: r?.level ?? null, comment: r?.comment ?? null, certified: !!r?.certificate });
  };
  roster.forEach((s) => push(`s:${s.studentId}`, s.name, false));
  results.forEach((r) => (r.student ? push(`s:${r.studentId}`, fullName(r.student), false) : r.lead && push(`l:${r.leadId}`, r.lead.name, true)));
  const st = examStats(results);
  const [students, leads] = canEdit
    ? await Promise.all([
        db.student.findMany({ where: { centerId: ctx.centerId, status: "ACTIVE", ...studentScope({ ...ctx, activeBranchId: null }) }, select: { id: true, firstName: true, lastName: true }, orderBy: [{ lastName: "asc" }, { firstName: "asc" }], take: 2000 }),
        db.lead.findMany({ where: { centerId: ctx.centerId, archivedAt: null, stage: { notIn: ["ENROLLED", "LOST"] }, ...(ctx.branchIds ? { OR: [{ branchId: { in: ctx.branchIds } }, { branchId: null }] } : {}) }, select: { id: true, name: true, phone: true }, orderBy: { createdAt: "desc" }, take: 500 }),
      ])
    : [[], []];
  const certifiable = (exam.kind === "LEVEL" || exam.kind === "FINAL") && results.some((r) => r.studentId && r.passed !== false && !r.certificate);
  return (
    <>
      <PageHeader
        back={{ href: "/exams", label: t("nav.exams") }}
        title={exam.title}
        subtitle={<Badge tone="blue">{t(`exams.kind.${exam.kind}`)}</Badge>}
        actions={
          canEdit && (
            <>
              {ctx.can("export") && results.length > 0 && <LinkButton variant="secondary" href={`/api/export/exam-results?examId=${id}`}>{t("common.export")}</LinkButton>}
              <Modal label={t("exams.addParticipant")} title={t("exams.addParticipant")} variant="secondary">
                <ModalForm action={addParticipantAction} className="space-y-3">
                  <input type="hidden" name="examId" value={id} />
                  <FormGrid>
                    <Field label={t("exams.pickStudent")}>
                      <Select name="studentId" defaultValue="">
                        <option value="">—</option>
                        {students.map((s) => <option key={s.id} value={s.id}>{fullName(s)}</option>)}
                      </Select>
                    </Field>
                    <Field label={t("exams.pickLead")}>
                      <Select name="leadId" defaultValue="">
                        <option value="">—</option>
                        {leads.map((l) => <option key={l.id} value={l.id}>{l.name} · +{l.phone}</option>)}
                      </Select>
                    </Field>
                  </FormGrid>
                  {sections.length > 0 ? (
                    <FormGrid cols={4}>{sections.map((s, i) => <Field key={i} label={`${s.name} /${s.max}`}><Input name={`s:new:sec:${i}`} inputMode="numeric" required /></Field>)}</FormGrid>
                  ) : (
                    <Field label={`${t("exams.score")} /${exam.maxScore}`}><Input name="s:new:total" inputMode="numeric" required /></Field>
                  )}
                  <Field label={t("exams.comment")}><Input name="comment" maxLength={500} /></Field>
                  <SubmitButton>{t("common.add")}</SubmitButton>
                </ModalForm>
              </Modal>
              {results.some((r) => r.studentId) && (
                <ActionForm action={publishExamAction}>
                  <input type="hidden" name="examId" value={id} />
                  <SubmitButton variant="secondary" confirm={t("exams.publishConfirm")}>{t("exams.publish")}</SubmitButton>
                </ActionForm>
              )}
              {certifiable && (
                <ActionForm action={issueCertificatesAction}>
                  <input type="hidden" name="examId" value={id} />
                  <SubmitButton confirm={t("exams.issueConfirm")}>{t("exams.issue")}</SubmitButton>
                </ActionForm>
              )}
            </>
          )
        }
      />
      <Card className="mb-4">
        <KV
          items={[
            [t("common.date"), formatDate(toISODate(exam.date))],
            [t("exams.group"), exam.group ? <Link href={`/groups/${exam.group.id}`} className="hover:underline">{exam.group.name} #{exam.group.code}</Link> : "—"],
            [t("exams.course"), exam.course?.name ?? exam.group?.course.name ?? "—"],
            [t("exams.maxScore"), String(exam.maxScore)],
            [t("exams.passScore"), exam.passScore === null ? "—" : String(exam.passScore)],
            ...(bands.length ? [[t("exams.bands"), bands.map((b) => `${b.min}+ ${b.level}`).join(" · ")] as [string, string]] : []),
            [t("exams.results"), t("exams.stats", { count: st.count, avg: st.avg ?? "—", passed: st.passed, failed: st.failed })],
            ...(exam.publishedAt ? [[t("rc.SENT"), t("exams.publishedAt", { date: formatDateTime(exam.publishedAt) })] as [string, string]] : []),
          ]}
        />
      </Card>
      <ExamResultsBoard examId={id} rows={rows} sections={sections} maxScore={exam.maxScore} t={t} locked={!canEdit} />
    </>
  );
}
