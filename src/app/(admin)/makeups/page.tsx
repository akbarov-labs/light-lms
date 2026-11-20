import Link from "next/link";
import { CalendarCheck } from "lucide-react";
import { requireStaff } from "@/lib/ctx";
import { db } from "@/lib/db";
import { formatDate, toISODate, todayISO } from "@/lib/dates";
import { readSettings } from "@/lib/settings";
import { missedWithoutMakeup, nextAllowedDay, plannedMakeups } from "@/lib/services/makeups";
import { Badge, Card, EmptyState, PageHeader, Table, Td, Th, Tr } from "@/components/ui";
import { Field, Input } from "@/components/fields";
import { ActionForm, SubmitButton } from "@/components/client";
import { CheckedCountSubmit } from "@/components/checked-submit";
import { makeupStatusAction, planMakeupsAction } from "./actions";

const TONE = { PLANNED: "blue", DONE: "green", MISSED: "red" } as const;

export default async function MakeupsPage() {
  const ctx = await requireStaff();
  const { t } = ctx;
  const today = todayISO();
  const settings = readSettings((await db.center.findUniqueOrThrow({ where: { id: ctx.centerId }, select: { settings: true } })).settings);
  const [missed, planned] = await Promise.all([missedWithoutMakeup(ctx, today), plannedMakeups(ctx, today)]);
  const canEdit = ctx.can("students.edit");
  const day = nextAllowedDay(today, settings.makeupWeekdays);
  return (
    <>
      <PageHeader title={t("nav.makeups")} subtitle={t("makeup.subtitle")} />
      <Card title={t("makeup.missed")} pad={false}>
        {missed.length === 0 ? (
          <EmptyState icon={<CalendarCheck className="h-6 w-6 text-emerald-600" strokeWidth={1.5} />}>{t("makeup.noneMissed")}</EmptyState>
        ) : (
          <ActionForm action={planMakeupsAction}>
            {canEdit && (
              <div className="flex flex-wrap items-end gap-3 border-b border-zinc-100 px-4 py-3">
                <Field label={t("makeup.date")}><Input type="date" name="date" defaultValue={day} min={today} required /></Field>
                <Field label={t("makeup.time")}><Input type="time" name="time" defaultValue="10:00" required /></Field>
                <CheckedCountSubmit name="absence" label={t("makeup.book", { n: "{n}" })} confirm={t("makeup.bookConfirm", { n: "{n}" })} selectAllLabel={t("debtors.selectAll")} />
              </div>
            )}
            <Table>
              <thead>
                <tr>{canEdit && <Th />}<Th>{t("common.student")}</Th><Th>{t("common.group")}</Th><Th>{t("makeup.missedLesson")}</Th></tr>
              </thead>
              <tbody>
                {missed.map((r) => (
                  <Tr key={`${r.studentId}:${r.lessonId}`}>
                    {canEdit && <Td><input type="checkbox" name="absence" value={`${r.studentId}:${r.lessonId}`} aria-label={`${r.student.lastName} ${r.student.firstName}`} className="h-4 w-4 accent-[rgb(var(--accent))]" /></Td>}
                    <Td><Link href={`/students/${r.studentId}`} className="font-medium text-zinc-900 hover:underline">{r.student.lastName} {r.student.firstName}</Link></Td>
                    <Td className="text-xs">{r.lesson.group.name} #{r.lesson.group.code}</Td>
                    <Td className="whitespace-nowrap text-xs">{formatDate(toISODate(r.lesson.date))} {r.lesson.startTime}</Td>
                  </Tr>
                ))}
              </tbody>
            </Table>
          </ActionForm>
        )}
      </Card>
      <div className="h-4" />
      <Card title={t("makeup.planned")} pad={false}>
        {planned.length === 0 ? (
          <EmptyState>{t("makeup.nonePlanned")}</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr><Th>{t("makeup.date")}</Th><Th>{t("common.student")}</Th><Th>{t("makeup.missedLesson")}</Th><Th /><Th /></tr>
            </thead>
            <tbody>
              {planned.map((p) => (
                <Tr key={p.id}>
                  <Td className="whitespace-nowrap font-medium text-zinc-900">{formatDate(toISODate(p.date))} {p.time}</Td>
                  <Td><Link href={`/students/${p.student.id}`} className="hover:underline">{p.student.lastName} {p.student.firstName}</Link></Td>
                  <Td className="whitespace-nowrap text-xs">{p.lesson.group.name} · {formatDate(toISODate(p.lesson.date))}</Td>
                  <Td><Badge tone={TONE[p.status]}>{t(`makeup.${p.status}`)}</Badge></Td>
                  <Td className="text-right">
                    {canEdit && (
                      <ActionForm action={makeupStatusAction} className="inline-flex gap-1">
                        <input type="hidden" name="id" value={p.id} />
                        {(["DONE", "MISSED"] as const).filter((s) => s !== p.status).map((s) => (
                          <SubmitButton key={s} size="sm" variant="secondary" name="status" value={s}>{t(`makeup.${s}`)}</SubmitButton>
                        ))}
                      </ActionForm>
                    )}
                  </Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
