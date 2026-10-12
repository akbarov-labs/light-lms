import { AttendanceMark } from "@/components/attendance-mark";
import Link from "next/link";
import { Check, ChevronRight, Plus } from "lucide-react";
import { notFound } from "next/navigation";
import { requireStaff, studentScope } from "@/lib/ctx";
import type { DictKey } from "@/lib/i18n";
import { db } from "@/lib/db";
import { addDays, formatDate, formatDateTime, fromISODate, toISODate, todayISO } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { attendanceTone, enrollmentTone, fullName } from "@/lib/format";
import { familyAllocation, familyLedger } from "@/lib/services/wallet";
import { Badge, Card, EmptyState, KV, LinkButton, PageHeader, Table, Td, Th, Tr, cx } from "@/components/ui";
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
  const studentDebt = student.enrollments.reduce((sum, e) => sum + (alloc.enrollments.get(e.id)?.debt ?? 0), 0);
  const hasSiblings = student.family.students.length > 1;
  const studentOldest = alloc.units.filter((u) => u.due > 0 && u.enrollmentId && enrollmentIds.includes(u.enrollmentId)).map((u) => u.firstDate).sort()[0] ?? null;
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
        <div className="mb-4 rounded-xl border border-line bg-white px-5 py-4">
          <div className="text-[13px] text-zinc-500">{t("common.debt")}</div>
          <div className={cx("tnum mt-0.5 text-[28px] font-semibold leading-tight tracking-[-0.02em]", studentDebt > 0 ? "text-red-600" : "text-zinc-950")}>{formatMoney(studentDebt)}</div>
          <div className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px] text-zinc-500">
            {studentDebt > 0 && studentOldest && <span>{t("students.oldestFrom", { date: formatDate(studentOldest) })}</span>}
            {hasSiblings && alloc.totalDebt !== studentDebt && (
              <Link href={`/families/${student.familyId}`} className="inline-flex items-center gap-0.5 font-medium text-zinc-700 hover:text-zinc-950">
                {t("students.familyTotal", { amount: formatMoney(alloc.totalDebt) })}
                <ChevronRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            )}
            {alloc.unallocated > 0 && <span>{t("students.prepaid")}: <span className="tnum font-medium text-zinc-900">{formatMoney(alloc.unallocated)}</span></span>}
          </div>
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
          {student.notes && <p className="mt-3 whitespace-pre-line rounded-lg bg-zinc-50 p-3 text-sm text-zinc-700">{student.notes}</p>}
        </Card>
        <Card title={<Link href={`/families/${student.familyId}`} className="inline-flex items-center gap-1 hover:underline hover:decoration-zinc-400">{student.family.name}<ChevronRight className="h-3.5 w-3.5 text-zinc-400" aria-hidden /></Link>}>
          <div className="space-y-2 text-sm">
            {student.family.guardians.map((g) => (
              <div key={g.id} className="flex items-center justify-between gap-2">
                <div>
                  <div className="font-medium">{g.name} {g.isPrimary && <span className="text-xs text-zinc-500">· {t("students.primary")}</span>}</div>
                  <a href={`tel:+${g.phone}`} className="text-xs text-zinc-900 underline decoration-zinc-300 hover:decoration-zinc-900">{formatPhone(g.phone)}</a>
                </div>
                {g.telegramChatId && <Badge tone="blue">TG</Badge>}
              </div>
            ))}
            {student.family.students.length > 1 && (
              <div className="border-t border-zinc-100 pt-2">
                <div className="mb-1 text-xs text-zinc-500">{t("students.siblings")}</div>
                {student.family.students.filter((s) => s.id !== id).map((s) => (
                  <Link key={s.id} href={`/students/${s.id}`} className="block text-zinc-900 underline decoration-zinc-300 hover:decoration-zinc-900">{fullName(s)}</Link>
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
          <Modal label={t("students.addToGroup")} icon={<Plus className="h-3.5 w-3.5" aria-hidden />} title={t("students.addToGroup")} size="sm" variant="secondary">
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
                      <Link href={`/groups/${e.groupId}`} className="font-medium text-zinc-900 hover:underline hover:decoration-zinc-400">{e.group.name} <span className="text-zinc-500">#{e.group.code}</span></Link>
                      <div className="text-xs text-zinc-500">{e.group.course.name} · {e.group.teacher.name}</div>
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
                      {e.transferredTo && <div className="text-xs text-zinc-500">{t("enr.movedTo", { group: `${e.transferredTo.group.name} #${e.transferredTo.group.code}` })}</div>}
                      {e.leftReason && <div className="text-xs text-zinc-500">{e.leftReason}</div>}
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
                      <div className="text-zinc-500">{e.activatedAt ? `${t("enr.activatedAt")}: ${formatDate(toISODate(e.activatedAt))}` : t("enr.trialUntilActivated")}</div>
                    </Td>
                    {showMoney && <Td className={cx("whitespace-nowrap text-right font-medium", (eb?.debt ?? 0) > 0 ? "text-red-600" : "text-zinc-500")}>{formatMoney(eb?.debt ?? 0)}<div className="text-xs font-normal text-zinc-500">{formatMoney(eb?.paid ?? 0)} / {formatMoney(eb?.charged ?? 0)}</div></Td>}
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
                  <Td className={cx("whitespace-nowrap text-right font-medium", u.due > 0 ? "text-red-600" : "text-zinc-500")}>{u.due > 0 ? formatMoney(u.due) : <span className="inline-flex items-center gap-1 text-emerald-700"><Check className="h-3.5 w-3.5" aria-hidden />{t("students.unitPaid")}</span>}</Td>
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
                    <Td className="whitespace-nowrap text-xs"><Link href={`/lessons/${a.lesson.id}`} className="hover:underline hover:decoration-zinc-400">{formatDate(toISODate(a.lesson.date))} {a.lesson.startTime}</Link></Td>
                    <Td className="text-xs">{a.lesson.group.name}</Td>
                    <Td><Badge tone={attendanceTone[a.status]}><AttendanceMark status={a.status} label="" /> {t(`attendance.${a.status}`)}</Badge></Td>
                    <Td className="text-right text-xs">{a.grade ?? ""}{a.comment && <span className="ml-1 text-zinc-500">{a.comment}</span>}</Td>
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
            <ul className="divide-y divide-zinc-100 text-sm">
              {events.map((ev) => (
                <li key={ev.id} className="flex justify-between gap-3 px-4 py-2">
                  <span className="text-zinc-700">{(() => { const k = `hist.${ev.action}` as DictKey; const label = t(k); return label === k ? `${ev.entity} · ${ev.action}` : label; })()}</span>
                  <span className="whitespace-nowrap text-xs text-zinc-500">{formatDateTime(ev.createdAt)} · {ev.userId ? users.get(ev.userId) : t("audit.system")}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>

      {showMoney && (
        <Card className="mt-4" pad={false} title={t("students.ledger")}>
          {hasSiblings && <p className="border-b border-zinc-100 px-4 py-2 text-xs text-zinc-500">{t("students.ledgerHint")}</p>}
          <LedgerTable ctx={ctx} rows={hasSiblings ? ledger.filter((l) => l.studentId === id) : ledger} showBalance={!hasSiblings} />
        </Card>
      )}
    </>
  );
}
