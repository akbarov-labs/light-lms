import Link from "next/link";
import { notFound } from "next/navigation";
import { canAccessBranch, requireCtx } from "@/lib/ctx";
import { db } from "@/lib/db";
import { formatDate, toISODate, todayISO } from "@/lib/dates";
import { attendanceLabels, lessonRoster } from "@/lib/roster";
import { AttendanceForm } from "@/components/attendance-form";
import { Badge } from "@/components/ui";
import { saveAttendanceAction } from "@/app/(admin)/lessons/actions";
import { lessonHomework } from "@/lib/services/homework";
import { HomeworkPanel } from "@/components/homework-panel";

export default async function TeacherLesson({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ hw?: string }> }) {
  const { id } = await params;
  const { hw } = await searchParams;
  const ctx = await requireCtx();
  const { t } = ctx;
  const lesson = await db.lesson.findUnique({ where: { id }, include: { group: true, room: true } });
  if (!lesson || lesson.group.centerId !== ctx.centerId || (lesson.teacherId !== ctx.userId && lesson.group.teacherId !== ctx.userId && !(ctx.can("groups.edit") && canAccessBranch(ctx, lesson.group.branchId)))) notFound();
  const [rows, homework] = await Promise.all([lessonRoster(id), ctx.settings.homework.enabled ? lessonHomework(lesson, ctx.settings.homework) : null]);
  const date = toISODate(lesson.date);
  return (
    <div className="space-y-4">
      <Link href="/t" className="text-sm text-zinc-500">← {t("t.today")}</Link>
      <div>
        <h1 className="text-lg font-semibold">{lesson.group.name} <span className="text-zinc-500">#{lesson.group.code}</span></h1>
        <div className="flex items-center gap-2 text-sm text-zinc-500">
          {formatDate(date)} · {lesson.startTime}–{lesson.endTime}{lesson.room ? ` · ${lesson.room.name}` : ""}
          <Badge tone={lesson.status === "HELD" ? "green" : lesson.status === "CANCELLED" ? "gray" : "blue"}>{t(`lesson.${lesson.status}`)}</Badge>
        </div>
      </div>
      <AttendanceForm
        action={saveAttendanceAction}
        lessonId={id}
        rows={rows}
        labels={attendanceLabels(t)}
        maxGrade={ctx.settings.gradeScale === "100" ? 100 : 5}
        topic={lesson.topic}
        disabled={lesson.status === "CANCELLED" || date > todayISO()}
        stickyClass="bottom-[76px]"
      />
      {homework && (
        <HomeworkPanel
          t={t}
          lessonId={id}
          set={homework.set}
          due={homework.due}
          canEdit
          lessonCancelled={lesson.status === "CANCELLED"}
          showAll={hw === "all"}
          path={`/t/lessons/${id}`}
          directFromGrade={ctx.settings.homework.directFromGrade}
        />
      )}
    </div>
  );
}
