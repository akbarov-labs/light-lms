import Link from "next/link";
import { Check, ChevronRight } from "lucide-react";
import { branchWhere, requireStaff } from "@/lib/ctx";
import { db } from "@/lib/db";
import { addDays, formatDate, fromISODate, toISODate, todayISO } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { fullName, leadTone, lessonTone } from "@/lib/format";
import { listDebtors } from "@/lib/queries/debtors";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Table, Td, Tr } from "@/components/ui";

export default async function TodayPage() {
  const ctx = await requireStaff();
  const { t } = ctx;
  const today = todayISO();
  const bw = branchWhere(ctx);
  const [lessons, missing, trials, leads, debtors] = await Promise.all([
    db.lesson.findMany({
      where: { date: fromISODate(today), group: { centerId: ctx.centerId, ...bw } },
      include: { group: { select: { id: true, name: true, code: true } }, teacher: { select: { name: true } }, room: { select: { name: true } }, _count: { select: { attendance: true } } },
      orderBy: { startTime: "asc" },
    }),
    db.lesson.findMany({
      where: { status: "SCHEDULED", date: { gte: fromISODate(addDays(today, -7)), lt: fromISODate(today) }, group: { centerId: ctx.centerId, ...bw } },
      include: { group: { select: { name: true, code: true } }, teacher: { select: { name: true } } },
      orderBy: { date: "desc" },
    }),
    db.enrollment.findMany({
      where: { status: "TRIAL", endDate: null, group: { centerId: ctx.centerId, ...bw, lessons: { some: { date: fromISODate(today), status: { not: "CANCELLED" } } } } },
      include: { student: { select: { id: true, firstName: true, lastName: true, phone: true } }, group: { select: { id: true, name: true, code: true, lessons: { where: { date: fromISODate(today) }, select: { startTime: true } } } } },
    }),
    ctx.can("leads")
      ? db.lead.findMany({
          where: { centerId: ctx.centerId, archivedAt: null, stage: { notIn: ["ENROLLED", "LOST"] }, nextContactAt: { lte: fromISODate(today) }, ...(ctx.branchIds ? { OR: [{ branchId: { in: ctx.branchIds } }, { branchId: null }] } : {}) },
          orderBy: { nextContactAt: "asc" },
          take: 30,
        })
      : Promise.resolve([]),
    ctx.can("payments.take") ? listDebtors(ctx, {}) : Promise.resolve([]),
  ]);
  return (
    <>
      <PageHeader title={t("nav.today")} subtitle={formatDate(today)} />
      <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        {missing.length > 0 && (
          <Card className="border-amber-200 xl:col-span-2" pad={false} title={<span className="text-amber-800">{`${t("today.missingPast")} (${missing.length})`}</span>}>
            <Table>
              <tbody>
                {missing.map((l) => (
                  <Tr key={l.id}>
                    <Td className="whitespace-nowrap text-xs"><Link href={`/lessons/${l.id}`} className="text-zinc-900 underline decoration-zinc-300 hover:decoration-zinc-900">{formatDate(toISODate(l.date))} {l.startTime}</Link></Td>
                    <Td className="text-xs">{l.group.name} #{l.group.code}</Td>
                    <Td className="text-xs">{l.teacher.name}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </Card>
        )}
        <Card pad={false} title={`${t("today.lessons")} (${lessons.length})`}>
          {lessons.length === 0 ? <EmptyState>{t("common.empty")}</EmptyState> : (
            <Table>
              <tbody>
                {lessons.map((l) => (
                  <Tr key={l.id}>
                    <Td className="whitespace-nowrap font-medium">{l.startTime}–{l.endTime}</Td>
                    <Td><Link href={`/groups/${l.group.id}`} className="hover:underline hover:decoration-zinc-400">{l.group.name} #{l.group.code}</Link><div className="text-xs text-zinc-500">{l.teacher.name}{l.room ? ` · ${l.room.name}` : ""}</div></Td>
                    <Td><Badge tone={lessonTone[l.status]}>{t(`lesson.${l.status}`)}</Badge></Td>
                    <Td className="text-right">{l.status !== "CANCELLED" && <Link href={`/lessons/${l.id}`} className="text-sm text-zinc-900 underline decoration-zinc-300 hover:decoration-zinc-900">{l._count.attendance ? <span className="inline-flex items-center gap-1"><Check className="h-3.5 w-3.5 text-emerald-700" aria-hidden />{l._count.attendance}</span> : t("today.markNow")}</Link>}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        <Card pad={false} title={`${t("today.trials")} (${trials.length})`}>
          {trials.length === 0 ? <EmptyState>{t("common.empty")}</EmptyState> : (
            <Table>
              <tbody>
                {trials.map((e) => (
                  <Tr key={e.id}>
                    <Td className="whitespace-nowrap">{e.group.lessons[0]?.startTime}</Td>
                    <Td><Link href={`/students/${e.student.id}`} className="font-medium hover:underline hover:decoration-zinc-400">{fullName(e.student)}</Link><div className="text-xs text-zinc-500">{e.group.name} #{e.group.code}</div></Td>
                    <Td className="text-xs">{e.student.phone && <a href={`tel:+${e.student.phone}`} className="text-zinc-900 underline decoration-zinc-300 hover:decoration-zinc-900">{formatPhone(e.student.phone)}</a>}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
        {ctx.can("leads") && (
          <Card pad={false} title={`${t("today.calls")} (${leads.length})`}>
            {leads.length === 0 ? <EmptyState>{t("common.empty")}</EmptyState> : (
              <Table>
                <tbody>
                  {leads.map((l) => (
                    <Tr key={l.id}>
                      <Td><Link href={`/leads/${l.id}`} className="font-medium hover:underline hover:decoration-zinc-400">{l.name}</Link><div className="text-xs text-zinc-500">{formatDate(l.nextContactAt)}</div></Td>
                      <Td><Badge tone={leadTone[l.stage]}>{t(`lead.${l.stage}`)}</Badge></Td>
                      <Td className="text-right text-xs"><a href={`tel:+${l.phone}`} className="text-zinc-900 underline decoration-zinc-300 hover:decoration-zinc-900">{formatPhone(l.phone)}</a></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        )}
        {ctx.can("payments.take") && (
          <Card pad={false} title={`${t("today.debtors")} (${debtors.length})`} actions={<Link href="/debtors" className="inline-flex items-center gap-1 text-[13px] text-zinc-600 hover:text-zinc-900">{t("today.allDebtors")}<ChevronRight className="h-3.5 w-3.5" aria-hidden /></Link>}>
            {debtors.length === 0 ? <EmptyState>{t("common.empty")}</EmptyState> : (
              <Table>
                <tbody>
                  {debtors.slice(0, 10).map((d) => (
                    <Tr key={d.familyId}>
                      <Td>{d.students.map((s) => <Link key={s.id} href={`/students/${s.id}`} className="block font-medium hover:underline hover:decoration-zinc-400">{s.name}</Link>)}</Td>
                      <Td className="tnum whitespace-nowrap text-right">
                        <div className="font-semibold text-red-600">{formatMoney(d.debt)}</div>
                        <div className="text-xs text-zinc-500">
                          {d.daysOverdue > 0 && t("today.overdueDays", { n: d.daysOverdue })}
                          {d.daysOverdue > 0 && d.phone && " · "}
                          {d.phone && <a href={`tel:+${d.phone}`} className="underline decoration-zinc-300 hover:text-zinc-900">{formatPhone(d.phone)}</a>}
                        </div>
                      </Td>
                      <Td className="text-right"><LinkButton variant="secondary" size="sm" href={`/families/${d.familyId}?pay=1`}>{t("today.takePay")}</LinkButton></Td>
                    </Tr>
                  ))}
                </tbody>
              </Table>
            )}
          </Card>
        )}
      </div>
    </>
  );
}
