import Link from "next/link";
import { notFound } from "next/navigation";
import { requireStaff, studentScope } from "@/lib/ctx";
import { db } from "@/lib/db";
import { addDays, formatDate, formatDateTime, fromISODate, toISODate, todayISO } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { attendanceMark, attendanceTone, enrollmentTone, fullName } from "@/lib/format";
import { familyAllocation, familyLedger } from "@/lib/services/wallet";
import { Badge, Card, EmptyState, KV, LinkButton, PageHeader, Stat, Table, Td, Th, Tr, cx } from "@/components/ui";
import { ActionForm, Modal, SubmitButton } from "@/components/client";
import { LedgerTable } from "@/components/ledger-table";
import { EnrollForm, EnrollmentActions } from "../../enrollments/ui";
import { endFreezeAction } from "../../enrollments/actions";
import { toggleStudentArchiveAction } from "../actions";

export default async function StudentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireStaff();
  const { t } = ctx;
  const student = await db.student.findFirst({
    where: { id, centerId: ctx.centerId, ...(ctx.branchIds ? { OR: [studentScope({ ...ctx, activeBranchId: null }), { branchId: null }] } : {}) },
    include: {
      branch: true,
      family: { include: { guardians: { orderBy: { isPrimary: "desc" } }, students: { select: { id: true, firstName: true, lastName: true, status: true } } } },
      enrollments: {
        include: { group: { include: { course: { select: { name: true, pricingType: true } }, teacher: { select: { name: true } } } }, freezes: { orderBy: { fromDate: "desc" } }, transferredTo: { include: { group: { select: { name: true, code: true } } } } },
        orderBy: [{ endDate: { sort: "desc", nulls: "first" } }, { startDate: "desc" }],
      },
    },
  });
  if (!student) notFound();
  const showMoney = ctx.can("finance.view") || ctx.can("payments.take");
  const today = todayISO();
  const [alloc, ledger, attendance, groups] = await Promise.all([
    familyAllocation(student.familyId),
    showMoney ? familyLedger(student.familyId) : Promise.resolve([]),
    db.attendance.findMany({
      where: { studentId: id, lesson: { date: { gte: fromISODate(addDays(today, -30)) } } },
      include: { lesson: { select: { id: true, date: true, startTime: true, group: { select: { name: true } } } } },
      orderBy: { lesson: { date: "desc" } },
    }),
    db.group.findMany({ where: { centerId: ctx.centerId, status: { in: ["ACTIVE", "PLANNED"] }, ...(ctx.branchIds ? { branchId: { in: ctx.branchIds } } : {}) }, select: { id: true, name: true, code: true }, orderBy: { name: "asc" } }),
  ]);
  const enrollmentIds = student.enrollments.map((e) => e.id);
  const events = await db.auditLog.findMany({
    where: { centerId: ctx.centerId, OR: [{ entity: "Student", entityId: id }, { entity: "Enrollment", entityId: { in: enrollmentIds }, action: { not: "billing.sync" } }] },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  const users = new Map((await db.user.findMany({ where: { id: { in: [...new Set(events.map((e) => e.userId).filter(Boolean))] as string[] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const open = student.enrollments.filter((e) => !e.endDate);
  const myUnits = alloc.units.filter((u) => u.enrollmentId && enrollmentIds.includes(u.enrollmentId));

  return (
    <>
      <PageHeader
        back={{ href: "/students", label: t("nav.students") }}
        title={fullName(student)}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Badge tone={student.status === "ACTIVE" ? "green" : "gray"}>{t(`student.${student.status}`)}</Badge>
            {student.tags.map((tg) => <Badge key={tg} tone="violet">#{tg}</Badge>)}
            {student.telegramChatId && <Badge tone="blue">{t("students.telegramLinked")}</Badge>}
          </span>
        }
        actions={
          <>
            {ctx.can("payments.take") && <LinkButton href={`/families/${student.familyId}?pay=1&student=${id}`}>{t("students.takePayment")}</LinkButton>}
            {ctx.can("students.edit") && <LinkButton variant="secondary" href={`/students/${id}/edit`}>{t("common.edit")}</LinkButton>}
            {ctx.can("archive") && (
              <ActionForm action={toggleStudentArchiveAction}>
                <input type="hidden" name="id" value={id} />
                <SubmitButton variant="ghost" confirm={t("common.confirm")}>{student.status === "ACTIVE" ? t("common.archive") : t("common.restore")}</SubmitButton>
              </ActionForm>
            )}
          </>
        }
      />

      {showMoney && (
        <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat label={t("students.familyBalance")} value={formatMoney(alloc.balance)} tone={alloc.balance < 0 ? "red" : alloc.balance > 0 ? "green" : undefined} href={`/families/${student.familyId}`} />
          <Stat label={t("common.debt")} value={formatMoney(alloc.totalDebt)} tone={alloc.totalDebt > 0 ? "red" : undefined} hint={alloc.oldestUnpaidDate ? `${t("common.from")} ${formatDate(alloc.oldestUnpaidDate)}` : undefined} />
          <Stat label={t("students.prepaid")} value={formatMoney(alloc.unallocated)} />
          <Stat label={t("students.groups")} value={open.length} />
        </div>
      )}

      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2" title={t("common.details")}>
          <KV
            items={[
              [t("common.phone"), formatPhone(student.phone)],
              [t("students.birthDate"), formatDate(student.birthDate)],
              [t("students.gender"), student.gender ? t(`gender.${student.gender as "M"}`) : "—"],
              [t("common.branch"), student.branch?.name ?? "—"],
              [t("common.source"), student.source ?? "—"],
              [t("common.createdAt"), formatDate(student.createdAt)],
            ]}
          />
          {student.notes && <p className="mt-3 whitespace-pre-line rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{student.notes}</p>}
        </Card>
        <Card title={<Link href={`/families/${student.familyId}`} className="hover:text-accent">{student.family.name} →</Link>}>
          <div className="space-y-2 text-sm">
            {student.family.guardians.map((g) => (
              <div key={g.id} className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-medium">{g.name} {g.isPrimary && <span className="text-xs text-slate-400">· {t("students.primary")}</span>}</div>
                  <a href={`tel:+${g.phone}`} className="text-xs text-accent">{formatPhone(g.phone)}</a>
                </div>
                {g.telegramChatId && <Badge tone="blue">TG</Badge>}
              </div>
            ))}
            {student.family.students.length > 1 && (
              <div className="border-t border-slate-100 pt-2">
                <div className="mb-1 text-xs text-slate-500">{t("students.siblings")}</div>
                {student.family.students.filter((s) => s.id !== id).map((s) => (
                  <Link key={s.id} href={`/students/${s.id}`} className="block text-accent hover:underline">{fullName(s)}</Link>
                ))}
              </div>
            )}
          </div>
        </Card>
      </div>

      <Card
        className="mb-4"
        pad={false}
        title={t("students.groups")}
        actions={ctx.can("students.edit") && student.status === "ACTIVE" && (
          <Modal label={`+ ${t("students.addToGroup")}`} title={t("students.addToGroup")} size="sm">
            <EnrollForm ctx={ctx} studentId={id} groups={groups.filter((g) => !open.some((e) => e.groupId === g.id))} />
          </Modal>
        )}
      >
        {student.enrollments.length === 0 ? (
          <EmptyState>{t("students.noGroup")}</EmptyState>
        ) : (
          <Table>
            <thead><tr><Th>{t("common.group")}</Th><Th>{t("common.status")}</Th><Th>{t("enr.period")}</Th>{showMoney && <Th className="text-right">{t("common.debt")}</Th>}<Th /></tr></thead>
            <tbody>
              {student.enrollments.map((e) => {
                const eb = alloc.enrollments.get(e.id);
                const freezes = e.freezes;
                return (
                  <Tr key={e.id} className={e.endDate ? "opacity-60" : ""}>
                    <Td>
                      <Link href={`/groups/${e.groupId}`} className="font-medium text-slate-900 hover:text-accent">{e.group.name} <span className="text-slate-400">#{e.group.code}</span></Link>
                      <div className="text-xs text-slate-500">{e.group.course.name} · {e.group.teacher.name}</div>
                      {freezes.length > 0 && (
                        <div className="mt-1 space-y-0.5">
                          {freezes.map((f) => (
                            <div key={f.id} className="flex items-center gap-2 text-xs text-sky-700">
                              ❄ {formatDate(toISODate(f.fromDate))} – {formatDate(toISODate(f.toDate))}{f.reason ? ` · ${f.reason}` : ""}
                              {toISODate(f.toDate) >= today && !e.endDate && ctx.can("students.edit") && (
                                <ActionForm action={endFreezeAction}>
                                  <input type="hidden" name="freezeId" value={f.id} />
                                  <input type="hidden" name="to" value={addDays(today, -1) < toISODate(f.fromDate) ? toISODate(f.fromDate) : addDays(today, -1)} />
                                  <SubmitButton variant="ghost" size="sm">{t("enr.endFreeze")}</SubmitButton>
                                </ActionForm>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </Td>
                    <Td>
                      <Badge tone={enrollmentTone[e.status]}>{t(`enrollment.${e.status}`)}</Badge>
                      {e.transferredTo && <div className="text-xs text-slate-500">{t("enr.movedTo", { group: `${e.transferredTo.group.name} #${e.transferredTo.group.code}` })}</div>}
                      {e.leftReason && <div className="text-xs text-slate-500">{e.leftReason}</div>}
                      {(e.discountPercent || e.discountAmount || e.priceOverride) && (
                        <div className="text-xs text-emerald-700">
                          {e.priceOverride ? `${formatMoney(e.priceOverride)} ` : ""}
                          {e.discountPercent ? `−${e.discountPercent}% ` : ""}
                          {e.discountAmount ? `−${formatMoney(e.discountAmount)} ` : ""}
                          {e.discountUntil ? `(${t("common.to").toLowerCase()} ${formatDate(toISODate(e.discountUntil))})` : ""}
                        </div>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap text-xs">
                      {formatDate(toISODate(e.startDate))} – {e.endDate ? formatDate(toISODate(e.endDate)) : "…"}
                      <div className="text-slate-400">{e.activatedAt ? `${t("enr.activatedAt")}: ${formatDate(toISODate(e.activatedAt))}` : t("enr.trialUntilActivated")}</div>
                    </Td>
                    {showMoney && <Td className={cx("whitespace-nowrap text-right font-medium", (eb?.debt ?? 0) > 0 ? "text-rose-600" : "text-slate-400")}>{formatMoney(eb?.debt ?? 0)}<div className="text-xs font-normal text-slate-400">{formatMoney(eb?.paid ?? 0)} / {formatMoney(eb?.charged ?? 0)}</div></Td>}
                    <Td><EnrollmentActions ctx={ctx} e={e} groups={groups} /></Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>

      {showMoney && myUnits.length > 0 && (
        <Card className="mb-4" pad={false} title={t("students.units")}>
          <Table>
            <thead><tr><Th>{t("enr.period")}</Th><Th className="text-right">{t("common.charged")}</Th><Th className="text-right">{t("common.paid")}</Th><Th className="text-right">{t("common.debt")}</Th></tr></thead>
            <tbody>
              {[...myUnits].reverse().map((u) => (
                <Tr key={u.key}>
                  <Td className="text-sm">{u.description}</Td>
                  <Td className="whitespace-nowrap text-right">{formatMoney(u.charged)}</Td>
                  <Td className="whitespace-nowrap text-right text-emerald-700">{formatMoney(u.paid)}</Td>
                  <Td className={cx("whitespace-nowrap text-right font-medium", u.due > 0 ? "text-rose-600" : "text-slate-400")}>{u.due > 0 ? formatMoney(u.due) : `✓ ${t("students.unitPaid")}`}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card pad={false} title={t("students.attendance")}>
          {attendance.length === 0 ? (
            <EmptyState>{t("common.empty")}</EmptyState>
          ) : (
            <Table>
              <tbody>
                {attendance.map((a) => (
                  <Tr key={a.id}>
                    <Td className="whitespace-nowrap text-xs"><Link href={`/lessons/${a.lesson.id}`} className="hover:text-accent">{formatDate(toISODate(a.lesson.date))} {a.lesson.startTime}</Link></Td>
                    <Td className="text-xs">{a.lesson.group.name}</Td>
                    <Td><Badge tone={attendanceTone[a.status]}>{attendanceMark[a.status]} {t(`attendance.${a.status}`)}</Badge></Td>
                    <Td className="text-right text-xs">{a.grade ?? ""}{a.comment && <span className="ml-1 text-slate-500">{a.comment}</span>}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card pad={false} title={t("students.history")}>
          {events.length === 0 ? (
            <EmptyState>{t("common.empty")}</EmptyState>
          ) : (
            <ul className="divide-y divide-slate-100 text-sm">
              {events.map((ev) => (
                <li key={ev.id} className="flex justify-between gap-3 px-4 py-2">
                  <span><code className="text-xs text-slate-600">{ev.entity}.{ev.action}</code></span>
                  <span className="whitespace-nowrap text-xs text-slate-500">{formatDateTime(ev.createdAt)} · {ev.userId ? users.get(ev.userId) : t("audit.system")}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {showMoney && (
        <Card className="mt-4" pad={false} title={t("students.ledger")}>
          <LedgerTable ctx={ctx} rows={ledger.filter((l) => !l.studentId || l.studentId === id)} />
        </Card>
      )}
    </>
  );
}
