import Link from "next/link";
import { notFound } from "next/navigation";
import { requireCtx } from "@/lib/ctx";
import { db } from "@/lib/db";
import { formatDate, toISODate } from "@/lib/dates";
import { fullName } from "@/lib/format";
import { examFor, examRoster, sectionsOf } from "@/lib/services/exams";
import { UserError } from "@/lib/user-error";
import { ExamResultsBoard, type ResultBoardRow } from "@/components/exam-results-board";

/** Teacher: enter the results of an exam of a group they lead. */
export default async function TeacherExam({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireCtx();
  const { t } = ctx;
  const exam = await examFor({ userId: ctx.userId, centerId: ctx.centerId, canEdit: false, branchIds: ctx.branchIds }, id, "results").catch((e: unknown) => {
    if (e instanceof UserError) notFound();
    throw e;
  });
  const [roster, results] = await Promise.all([
    examRoster(exam),
    db.examResult.findMany({ where: { examId: id }, include: { student: { select: { firstName: true, lastName: true } }, certificate: { select: { id: true } } } }),
  ]);
  const byStudent = new Map(results.filter((r) => r.studentId).map((r) => [r.studentId!, r]));
  const names = new Map(roster.map((s) => [s.studentId, s.name]));
  for (const r of results) if (r.studentId && r.student && !names.has(r.studentId)) names.set(r.studentId, fullName(r.student));
  const rows: ResultBoardRow[] = [...names.entries()].map(([sid, name]) => {
    const r = byStudent.get(sid);
    return { key: `s:${sid}`, name, isLead: false, score: r?.score ?? null, sectionScores: Array.isArray(r?.sectionScores) ? (r!.sectionScores as number[]) : [], passed: r?.passed ?? null, level: r?.level ?? null, comment: r?.comment ?? null, certified: !!r?.certificate };
  });
  return (
    <div className="space-y-3">
      <Link href="/t/reports" className="text-sm text-zinc-500 hover:text-zinc-900">← {t("rc.cards")}</Link>
      <h1 className="text-lg font-semibold">{exam.title}</h1>
      <p className="text-sm text-zinc-600">{t(`exams.kind.${exam.kind}`)} · {formatDate(toISODate(exam.date))} · {exam.group?.name}</p>
      <p className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600">{t("exams.teacherHint")}</p>
      <ExamResultsBoard examId={id} rows={rows} sections={sectionsOf(exam.sections)} maxScore={exam.maxScore} t={t} locked={!!exam.archivedAt} />
    </div>
  );
}
