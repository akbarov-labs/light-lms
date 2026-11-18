import Link from "next/link";
import { notFound } from "next/navigation";
import { canAccessBranch, requireStaff } from "@/lib/ctx";
import { db } from "@/lib/db";
import { formatDate, formatDateTime, toISODate, todayISO } from "@/lib/dates";
import { lessonTone } from "@/lib/format";
import { attendanceLabels, lessonRoster } from "@/lib/roster";
import { Badge, Card, KV, PageHeader } from "@/components/ui";
import { Field, FormGrid, Input, Select } from "@/components/fields";
import { ActionForm, Modal, ModalForm, SubmitButton } from "@/components/client";
import { AttendanceForm } from "@/components/attendance-form";
import { cancelLessonAction, rescheduleLessonAction, restoreLessonAction, saveAttendanceAction, substituteAction } from "../actions";
import { listTeachers } from "@/lib/queries/staff";
import { lessonHomework } from "@/lib/services/homework";
import { HomeworkPanel } from "@/components/homework-panel";

export default async function LessonPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ hw?: string }> }) {
  const { id } = await params;
  const { hw } = await searchParams;
  const ctx = await requireStaff();
  const { t } = ctx;
  const lesson = await db.lesson.findUnique({
    where: { id },
    include: { group: { include: { course: true, teacher: true } }, teacher: true, room: true, markedBy: { select: { name: true } } },
  });
  if (!lesson || lesson.group.centerId !== ctx.centerId || !canAccessBranch(ctx, lesson.group.branchId)) notFound();
  const date = toISODate(lesson.date);
  const homeworkOn = ctx.settings.homework.enabled;
  const [rows, teachers, rooms, homework] = await Promise.all([
    lessonRoster(id),
    listTeachers(ctx.centerId),
    db.room.findMany({ where: { branchId: lesson.group.branchId, archivedAt: null }, orderBy: { name: "asc" } }),
    homeworkOn ? lessonHomework(lesson) : null,
  ]);
  const canEdit = ctx.can("groups.edit");
  const ownTeacher = ctx.isTeacher && (lesson.teacherId === ctx.userId || lesson.group.teacherId === ctx.userId);
  const future = date > todayISO();
  return (
    <>
      <PageHeader
        back={{ href: `/groups/${lesson.groupId}`, label: `${lesson.group.name} #${lesson.group.code}` }}
        title={`${formatDate(date)} · ${lesson.startTime}–${lesson.endTime}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={lessonTone[lesson.status]}>{t(`lesson.${lesson.status}`)}</Badge>
            {lesson.cancelReason && <span>{t("lessons.cancelled", { reason: lesson.cancelReason })}</span>}
            {lesson.origDate && <span className="text-amber-700">{t("lessons.moved", { from: `${formatDate(toISODate(lesson.origDate))} ${lesson.origStartTime}` })}</span>}
          </span>
        }
        actions={
          canEdit && (
            <>
              {lesson.status !== "CANCELLED" ? (
                <Modal label={t("lessons.cancel")} title={t("lessons.cancel")} variant="secondary">
                  <ModalForm action={cancelLessonAction} className="space-y-3">
                    <input type="hidden" name="lessonId" value={id} />
                    <Field label={t("common.reason")}><Input name="reason" required /></Field>
                    <p className="text-xs text-zinc-500">{t("lessons.cancelHint")}</p>
                    <SubmitButton variant="danger">{t("lessons.cancel")}</SubmitButton>
                  </ModalForm>
                </Modal>
              ) : (
                <ActionForm action={restoreLessonAction}>
                  <input type="hidden" name="lessonId" value={id} />
                  <SubmitButton variant="secondary">{t("lessons.restore")}</SubmitButton>
                </ActionForm>
              )}
              {lesson.status !== "HELD" && (
                <Modal label={t("lessons.reschedule")} title={t("lessons.reschedule")} variant="secondary">
                  <ModalForm action={rescheduleLessonAction} className="space-y-3">
                    <input type="hidden" name="lessonId" value={id} />
                    <FormGrid cols={3}>
                      <Field label={t("lessons.newDate")}><Input type="date" name="date" defaultValue={date} required /></Field>
                      <Field label={t("lessons.newStart")}><Input type="time" name="startTime" defaultValue={lesson.startTime} required /></Field>
                      <Field label={t("lessons.newEnd")}><Input type="time" name="endTime" defaultValue={lesson.endTime} required /></Field>
                    </FormGrid>
                    <Field label={t("common.room")}>
                      <Select name="roomId" defaultValue={lesson.roomId ?? "-"}>
                        <option value="-">{t("groups.noRoom")}</option>
                        {rooms.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                      </Select>
                    </Field>
                    <SubmitButton>{t("common.save")}</SubmitButton>
                  </ModalForm>
                </Modal>
              )}
              <Modal label={t("lessons.substitute")} title={t("lessons.substitute")} variant="secondary">
                <ModalForm action={substituteAction} className="space-y-3">
                  <input type="hidden" name="lessonId" value={id} />
                  <Field label={t("common.teacher")}>
                    <Select name="teacherId" defaultValue={lesson.teacherId}>
                      {teachers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
                    </Select>
                  </Field>
                  <SubmitButton>{t("common.save")}</SubmitButton>
                </ModalForm>
              </Modal>
            </>
          )
        }
      />
      <Card className="mb-4">
        <KV
          items={[
            [t("common.group"), <Link key="g" href={`/groups/${lesson.groupId}`} className="hover:underline hover:decoration-zinc-400">{lesson.group.name}</Link>],
            [t("common.course"), lesson.group.course.name],
            [t("common.teacher"), lesson.teacherId !== lesson.group.teacherId ? `${lesson.teacher.name} (${t("lessons.substitute").toLowerCase()})` : lesson.teacher.name],
            [t("common.room"), lesson.room?.name ?? "—"],
            ...(lesson.markedBy ? [[t("lessons.attendance"), t("lessons.markedBy", { name: lesson.markedBy.name, time: formatDateTime(lesson.heldAt) })] as [string, string]] : []),
          ]}
        />
      </Card>
      <Card title={t("lessons.attendance")} pad={false}>
        <AttendanceForm
          framed={false}
          stickyClass="bottom-0"
          action={saveAttendanceAction}
          lessonId={id}
          rows={rows}
          labels={attendanceLabels(t)}
          maxGrade={ctx.settings.gradeScale === "100" ? 100 : 5}
          topic={lesson.topic}
          disabled={lesson.status === "CANCELLED" || future || !canEdit}
        />
      </Card>
      {homework && (
        <div className="mt-4">
          <HomeworkPanel
            t={t}
            lessonId={id}
            set={homework.set}
            due={homework.due}
            canEdit={canEdit || ownTeacher}
            lessonCancelled={lesson.status === "CANCELLED"}
            showAll={hw === "all"}
            path={`/lessons/${id}`}
            directFromGrade={ctx.settings.homework.directFromGrade}
          />
        </div>
      )}
    </>
  );
}
