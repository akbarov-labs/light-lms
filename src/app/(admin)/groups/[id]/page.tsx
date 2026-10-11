import Link from "next/link";
import { notFound } from "next/navigation";
import { canAccessBranch, requireStaff, studentScope } from "@/lib/ctx";
import { db } from "@/lib/db";
import { addDays, formatDate, fromISODate, toISODate, todayISO } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { attendanceMark, attendanceTone, enrollmentTone, fullName, groupTone, lessonTone, slotSummary } from "@/lib/format";
import { allocationsFor } from "@/lib/services/wallet";
import { Badge, Card, EmptyState, KV, LinkButton, PageHeader, Table, Td, Th, Tr, cx } from "@/components/ui";
import { ActionForm, Modal, SubmitButton } from "@/components/client";
import { EnrollForm, EnrollmentActions } from "../../enrollments/ui";
import { setGroupStatusAction } from "../actions";

export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireStaff();
  const { t } = ctx;
  const group = await db.group.findFirst({
    where: { id, centerId: ctx.centerId },
    include: { course: true, teacher: true, room: true, branch: true, slots: true },
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
  const open = enrollments.filter((e) => !e.endDate);
  const closed = enrollments.filter((e) => e.endDate);
  const inGroup = new Set(open.map((e) => e.studentId));
  const journal = [...past].filter((l) => l.status === "HELD").slice(0, 12).reverse();

  return (
    <>
      <PageHeader
        back={{ href: "/groups", label: t("nav.groups") }}
        title={<>{group.name} <span className="text-slate-400">#{group.code}</span></>}
        subtitle={<Badge tone={groupTone[group.status]}>{t(`group.${group.status}`)}</Badge>}
        actions={
          ctx.can("groups.edit") && (
            <>
              <LinkButton variant="secondary" href={`/groups/${id}/edit`}>{t("common.edit")}</LinkButton>
              {(ctx.can("finance.view") || ctx.can("settings")) && !ctx.branchIds && <LinkButton variant="ghost" href={`/audit?entity=Group&entityId=${id}`}>{t("students.history")}</LinkButton>}
              {group.status === "ACTIVE" || group.status === "PLANNED" ? (
                <ActionForm action={setGroupStatusAction}>
                  <input type="hidden" name="id" value={id} />
                  <SubmitButton variant="ghost" name="status" value="FINISHED" confirm={t("common.confirm")}>{t("groups.finish")}</SubmitButton>
                </ActionForm>
              ) : (
                <ActionForm action={setGroupStatusAction}>
                  <input type="hidden" name="id" value={id} />
                  <SubmitButton variant="ghost" name="status" value="ACTIVE">{t("common.restore")}</SubmitButton>
                </ActionForm>
              )}
              {ctx.can("archive") && group.status !== "ARCHIVED" && (
                <ActionForm action={setGroupStatusAction}>
                  <input type="hidden" name="id" value={id} />
                  <SubmitButton variant="ghost" name="status" value="ARCHIVED" confirm={t("common.confirm")}>{t("common.archive")}</SubmitButton>
                </ActionForm>
              )}
            </>
          )
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
            <Modal label={`+ ${t("groups.addStudent")}`} title={t("groups.addStudent")} size="sm">
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
                  <Tr key={e.id} className={e.endDate ? "opacity-60" : ""}>
                    <Td><Link href={`/students/${e.student.id}`} className="font-medium text-slate-900 hover:text-accent">{fullName(e.student)}</Link></Td>
                    <Td>
                      <Badge tone={enrollmentTone[e.status]}>{t(`enrollment.${e.status}`)}</Badge>
                      {e.transferredTo && <span className="ml-1 text-xs text-slate-500">{t("enr.movedTo", { group: `${e.transferredTo.group.name} #${e.transferredTo.group.code}` })}</span>}
                      {(e.discountPercent || e.discountAmount) && <span className="ml-1 text-xs text-emerald-600">−{e.discountPercent ? `${e.discountPercent}%` : formatMoney(e.discountAmount)}</span>}
                    </Td>
                    <Td className="whitespace-nowrap text-xs">
                      {formatDate(toISODate(e.startDate))} – {e.endDate ? formatDate(toISODate(e.endDate)) : "…"}
                      {e.activatedAt && <div className="text-slate-400">{t("enr.activatedAt")}: {formatDate(toISODate(e.activatedAt))}</div>}
                    </Td>
                    <Td className={cx("whitespace-nowrap text-right font-medium", debt > 0 ? "text-rose-600" : "text-slate-400")}>{debt > 0 ? formatMoney(debt) : "0"}</Td>
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
                    <Td className="whitespace-nowrap"><Link href={`/lessons/${l.id}`} className="font-medium hover:text-accent">{formatDate(toISODate(l.date))}</Link> <span className="text-xs text-slate-500">{l.startTime}</span></Td>
                    <Td className="text-xs">{l.teacherId !== group.teacherId ? <span className="text-amber-700">{l.teacher.name}</span> : null}</Td>
                    <Td>
                      {l.status === "SCHEDULED" && toISODate(l.date) <= today ? (
                        <Badge tone="amber">{t("groups.missingAttendance")}</Badge>
                      ) : (
                        <Badge tone={lessonTone[l.status]}>{t(`lesson.${l.status}`)}</Badge>
                      )}
                    </Td>
                    <Td className="text-right text-xs text-slate-500">{l.attendance.length > 0 && `${l.attendance.filter((a) => a.status === "PRESENT" || a.status === "LATE").length}/${l.attendance.length}`}</Td>
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
                    <Td className="whitespace-nowrap"><Link href={`/lessons/${l.id}`} className="font-medium hover:text-accent">{formatDate(toISODate(l.date))}</Link> <span className="text-xs text-slate-500">{t(`common.weekday.${new Date(l.date).getUTCDay() || 7}` as "common.weekday.1")} {l.startTime}–{l.endTime}</span></Td>
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
                        {a ? <Badge tone={attendanceTone[a.status]}>{attendanceMark[a.status]}{a.grade !== null ? ` ${a.grade}` : ""}</Badge> : <span className="text-slate-300">·</span>}
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
