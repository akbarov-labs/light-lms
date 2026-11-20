import { AttendanceMark } from "@/components/attendance-mark";
import Link from "next/link";
import { Plus } from "lucide-react";
import { notFound } from "next/navigation";
import { canAccessBranch, requireStaff, studentScope } from "@/lib/ctx";
import { db } from "@/lib/db";
import { addDays, formatDate, fromISODate, toISODate, todayISO } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { attendanceTone, enrollmentTone, fullName, groupTone, lessonTone, slotSummary } from "@/lib/format";
import { allocationsFor } from "@/lib/services/wallet";
import { Badge, Card, EmptyState, KV, LinkButton, PageHeader, Table, Td, Th, Tr, cx } from "@/components/ui";
import { ActionMenu, Modal, ModalForm, SubmitButton } from "@/components/client";
import { EnrollForm, EnrollmentActions } from "../../enrollments/ui";
import { setGroupStatusAction } from "../actions";
import { setGroupTopicAction } from "../../quizzes/actions";
import { topicOptions } from "@/lib/services/quizzes";
import { Field, Select } from "@/components/fields";

export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireStaff();
  const { t } = ctx;
  const group = await db.group.findFirst({
    where: { id, centerId: ctx.centerId },
    include: { course: true, teacher: true, room: true, branch: true, slots: true, currentTopic: { select: { code: true, title: true } } },
  });
  if (!group || !canAccessBranch(ctx, group.branchId)) notFound();
  const today = todayISO();

  const [enrollments, past, upcoming, otherGroups, students] = await Promise.all([
    db.enrollment.findMany({
      where: { groupId: id },
      include: { student: { select: { id: true, firstName: true, lastName: true, familyId: true, phone: true } }, transferredTo: { include: { group: { select: { name: true, code: true } } } } },
      orderBy: [{ endDate: { sort: "desc", nulls: "first" } }, { student: { lastName: "asc" } }],
    }),
    db.lesson.findMany({
      where: { groupId: id, date: { lte: fromISODate(today) } },
      include: { teacher: { select: { name: true } }, attendance: { select: { studentId: true, status: true, grade: true } } },
      orderBy: [{ date: "desc" }, { startTime: "desc" }],
      take: 14,
    }),
    db.lesson.findMany({
      where: { groupId: id, date: { gt: fromISODate(today), lte: fromISODate(addDays(today, 21)) } },
      include: { teacher: { select: { name: true } }, room: { select: { name: true } } },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
      take: 10,
    }),
    db.group.findMany({ where: { centerId: ctx.centerId, status: { in: ["ACTIVE", "PLANNED"] }, ...(ctx.branchIds ? { branchId: { in: ctx.branchIds } } : {}) }, select: { id: true, name: true, code: true }, orderBy: { code: "desc" } }),
    ctx.can("students.edit")
      ? db.student.findMany({ where: { centerId: ctx.centerId, status: "ACTIVE", ...(ctx.branchIds ? studentScope({ ...ctx, activeBranchId: null }) : {}) }, select: { id: true, firstName: true, lastName: true, phone: true }, orderBy: { lastName: "asc" }, take: 2000 })
      : Promise.resolve([]),
  ]);
  const allocs = await allocationsFor([...new Set(enrollments.map((e) => e.student.familyId))]);
  // the bank's topics: the owner marks where the group is now (topic tests, placement suggestions)
  const topics = ctx.can("groups.edit") ? await topicOptions(ctx.centerId) : [];
  const open = enrollments.filter((e) => !e.endDate);
  const closed = enrollments.filter((e) => e.endDate);
  const inGroup = new Set(open.map((e) => e.studentId));
  const journal = [...past].filter((l) => l.status === "HELD").slice(0, 12).reverse();

  return (
    <>
      <PageHeader
        back={{ href: "/groups", label: t("nav.groups") }}
        title={<>{group.name} <span className="text-zinc-500">#{group.code}</span></>}
        subtitle={<Badge tone={groupTone[group.status]}>{t(`group.${group.status}`)}</Badge>}
        actions={
          <>
            <LinkButton variant="secondary" href={`/groups/${id}/reports`}>{t("rc.title")}</LinkButton>
            {ctx.can("groups.edit") && (
              <>
                {topics.length > 0 && <LinkButton variant="secondary" href={`/quizzes/new?group=${id}`}>{t("quizzes.newForGroup")}</LinkButton>}
                <LinkButton variant="secondary" href={`/groups/${id}/edit`}>{t("common.edit")}</LinkButton>
                <ActionMenu
                  label={t("shell.more")}
                  items={[
                    ...((ctx.can("finance.view") || ctx.can("settings")) && !ctx.branchIds
                      ? [{ key: "history", label: t("students.history"), href: `/audit?entity=Group&entityId=${id}` }]
                      : []),
                    group.status === "ACTIVE" || group.status === "PLANNED"
                      ? {
                          key: "finish",
                          label: t("groups.finish"),
                          content: (
                            <ModalForm action={setGroupStatusAction} className="space-y-4">
                              <input type="hidden" name="id" value={id} />
                              <p className="text-sm text-zinc-600">{t("groups.finishHint")}</p>
                              <SubmitButton name="status" value="FINISHED">{t("groups.finish")}</SubmitButton>
                            </ModalForm>
                          ),
                        }
                      : {
                          key: "restore",
                          label: t("common.restore"),
                          content: (
                            <ModalForm action={setGroupStatusAction} className="space-y-4">
                              <input type="hidden" name="id" value={id} />
                              <SubmitButton name="status" value="ACTIVE">{t("common.restore")}</SubmitButton>
                            </ModalForm>
                          ),
                        },
                    ...(ctx.can("archive") && group.status !== "ARCHIVED"
                      ? [
                          {
                            key: "archive",
                            label: t("common.archive"),
                            danger: true,
                            content: (
                              <ModalForm action={setGroupStatusAction} className="space-y-4">
                                <input type="hidden" name="id" value={id} />
                                <p className="text-sm text-zinc-600">{t("groups.archiveHint")}</p>
                                <SubmitButton variant="danger" name="status" value="ARCHIVED">{t("common.archive")}</SubmitButton>
                              </ModalForm>
                            ),
                          },
                        ]
                      : []),
                  ]}
                />
              </>
            )}
          </>
        }
      />
      <Card className="mb-4">
        <KV
          items={[
            [t("common.course"), `${group.course.name} · ${t(`pricing.${group.course.pricingType}`)}`],
            [t("common.price"), formatMoney(group.priceOverride ?? group.course.price)],
            [t("common.teacher"), group.teacher.name],
            [t("common.branch"), `${group.branch.name}${group.room ? ` · ${group.room.name}` : ""}`],
            [t("groups.schedule"), slotSummary(group.slots, t)],
            [`${t("common.start")} – ${t("common.end")}`, `${formatDate(toISODate(group.startDate))} – ${group.endDate ? formatDate(toISODate(group.endDate)) : "…"}`],
            [t("groups.studentsCount"), `${open.length}${group.capacity ? ` / ${group.capacity}` : ""}`],
            ...(topics.length > 0 || group.currentTopic
              ? [
                  [
                    t("quizzes.groupTopic"),
                    <span key="topic" className="inline-flex flex-wrap items-center gap-2">
                      <span className={group.currentTopic ? "" : "text-zinc-500"}>{group.currentTopic ? `${group.currentTopic.code}. ${group.currentTopic.title}` : t("quizzes.groupTopicNone")}</span>
                      {topics.length > 0 && (
                        <Modal label={t("quizzes.groupTopicSet")} title={t("quizzes.groupTopicSet")} variant="secondary" size="sm">
                          <ModalForm action={setGroupTopicAction} className="space-y-3">
                            <input type="hidden" name="groupId" value={id} />
                            <Field label={t("quizzes.groupTopic")} hint={t("quizzes.groupTopicHint")}>
                              <Select name="topicId" defaultValue={group.currentTopicId ?? ""}>
                                <option value="">{t("quizzes.groupTopicNone")}</option>
                                {topics.map((x) => <option key={x.id} value={x.id}>{"  ".repeat(x.code.split(".").length - 1)}{x.code}. {x.title}</option>)}
                              </Select>
                            </Field>
                            <SubmitButton>{t("common.save")}</SubmitButton>
                          </ModalForm>
                        </Modal>
                      )}
                    </span>,
                  ] as [string, React.ReactNode],
                ]
              : []),
          ]}
        />
      </Card>

      <Card
        className="mb-4"
        pad={false}
        title={t("groups.studentsTab")}
        actions={
          ctx.can("students.edit") &&
          (group.status === "ACTIVE" || group.status === "PLANNED") && (
            <Modal label={t("groups.addStudent")} icon={<Plus className="h-3.5 w-3.5" aria-hidden />} title={t("groups.addStudent")} size="sm" variant="secondary">
              <EnrollForm ctx={ctx} groupId={id} students={students.filter((s) => !inGroup.has(s.id)).map((s) => ({ id: s.id, label: `${fullName(s)}${s.phone ? ` · ${s.phone.slice(3)}` : ""}` }))} />
            </Modal>
          )
        }
      >
        {enrollments.length === 0 ? (
          <EmptyState>{t("common.empty")}</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr><Th>{t("common.student")}</Th><Th>{t("common.status")}</Th><Th>{t("enr.period")}</Th><Th className="text-right">{t("common.debt")}</Th><Th /></tr>
            </thead>
            <tbody>
              {[...open, ...closed].map((e) => {
                const debt = allocs.get(e.student.familyId)?.enrollments.get(e.id)?.debt ?? 0;
                return (
                  <Tr key={e.id} muted={!!e.endDate}>
                    <Td className="whitespace-nowrap"><Link href={`/students/${e.student.id}`} className="font-medium text-zinc-900 hover:underline hover:decoration-zinc-400">{fullName(e.student)}</Link></Td>
                    <Td>
                      <Badge tone={enrollmentTone[e.status]}>{t(`enrollment.${e.status}`)}</Badge>
                      {e.transferredTo && <span className="ml-1 text-xs text-zinc-500">{t("enr.movedTo", { group: `${e.transferredTo.group.name} #${e.transferredTo.group.code}` })}</span>}
                      {(e.discountPercent || e.discountAmount) && <span className="ml-1 text-xs text-emerald-700">−{e.discountPercent ? `${e.discountPercent}%` : formatMoney(e.discountAmount)}</span>}
                    </Td>
                    <Td className="whitespace-nowrap text-xs">
                      {formatDate(toISODate(e.startDate))} – {e.endDate ? formatDate(toISODate(e.endDate)) : "…"}
                      {e.activatedAt && <div className="text-zinc-500">{t("enr.activatedAt")}: {formatDate(toISODate(e.activatedAt))}</div>}
                    </Td>
                    <Td className={cx("whitespace-nowrap text-right font-medium", debt > 0 ? "text-red-600" : "text-zinc-500")}>{formatMoney(debt)}</Td>
                    <Td><EnrollmentActions ctx={ctx} e={e} groups={otherGroups} /></Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card pad={false} title={t("groups.past")}>
          {past.length === 0 ? (
            <EmptyState>{t("common.empty")}</EmptyState>
          ) : (
            <Table>
              <tbody>
                {past.map((l) => (
                  <Tr key={l.id}>
                    <Td className="whitespace-nowrap"><Link href={`/lessons/${l.id}`} className="font-medium hover:underline hover:decoration-zinc-400">{formatDate(toISODate(l.date))}</Link> <span className="text-xs text-zinc-500">{l.startTime}</span></Td>
                    <Td className="text-xs">{l.teacherId !== group.teacherId ? <span className="text-amber-700">{l.teacher.name}</span> : null}</Td>
                    <Td>
                      {l.status === "SCHEDULED" && toISODate(l.date) <= today ? (
                        <Badge tone="amber">{t("groups.missingAttendance")}</Badge>
                      ) : (
                        <Badge tone={lessonTone[l.status]}>{t(`lesson.${l.status}`)}</Badge>
                      )}
                    </Td>
                    <Td className="text-right text-xs text-zinc-500">{l.attendance.length > 0 && `${l.attendance.filter((a) => a.status === "PRESENT" || a.status === "LATE").length}/${l.attendance.length}`}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card pad={false} title={t("groups.upcoming")}>
          {upcoming.length === 0 ? (
            <EmptyState>{t("common.empty")}</EmptyState>
          ) : (
            <Table>
              <tbody>
                {upcoming.map((l) => (
                  <Tr key={l.id}>
                    <Td className="whitespace-nowrap"><Link href={`/lessons/${l.id}`} className="font-medium hover:underline hover:decoration-zinc-400">{formatDate(toISODate(l.date))}</Link> <span className="text-xs text-zinc-500">{t(`common.weekday.${new Date(l.date).getUTCDay() || 7}` as "common.weekday.1")} {l.startTime}–{l.endTime}</span></Td>
                    <Td className="text-xs">{l.room?.name}{l.teacherId !== group.teacherId && <span className="ml-1 text-amber-700">{l.teacher.name}</span>}</Td>
                    <Td><Badge tone={lessonTone[l.status]}>{t(`lesson.${l.status}`)}</Badge></Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      {journal.length > 0 && open.length > 0 && (
        <Card className="mt-4" pad={false} title={t("groups.attendanceTab")}>
          <Table>
            <thead>
              <tr>
                <Th>{t("common.student")}</Th>
                {journal.map((l) => <Th key={l.id} className="text-center">{formatDate(toISODate(l.date)).slice(0, 5)}</Th>)}
              </tr>
            </thead>
            <tbody>
              {open.map((e) => (
                <Tr key={e.id}>
                  <Td className="whitespace-nowrap">{fullName(e.student)}</Td>
                  {journal.map((l) => {
                    const a = l.attendance.find((x) => x.studentId === e.studentId);
                    return (
                      <Td key={l.id} className="text-center">
                        {a ? <Badge tone={attendanceTone[a.status]}><AttendanceMark status={a.status} label={t(`attendance.${a.status}`)} />{a.grade !== null ? ` ${a.grade}` : ""}</Badge> : <span className="text-zinc-300">·</span>}
                      </Td>
                    );
                  })}
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
