import Link from "next/link";
import { requireCtx } from "@/lib/ctx";
import { db } from "@/lib/db";
import { addDays, formatDate, fromISODate, nowTimeHHmm, toISODate, todayISO } from "@/lib/dates";
import { Badge, cx } from "@/components/ui";

export default async function TeacherToday() {
  const ctx = await requireCtx();
  const { t } = ctx;
  const today = todayISO();
  const [lessons, missing] = await Promise.all([
    db.lesson.findMany({
      where: { teacherId: ctx.userId, date: fromISODate(today) },
      include: {
        group: { select: { name: true, code: true, _count: { select: { enrollments: { where: { startDate: { lte: fromISODate(today) }, OR: [{ endDate: null }, { endDate: { gte: fromISODate(today) } }] } } } } } },
        room: { select: { name: true } },
        _count: { select: { attendance: true } },
      },
      orderBy: { startTime: "asc" },
    }),
    db.lesson.findMany({
      where: { teacherId: ctx.userId, status: "SCHEDULED", date: { gte: fromISODate(addDays(today, -14)), lt: fromISODate(today) } },
      include: { group: { select: { name: true, code: true } } },
      orderBy: { date: "desc" },
    }),
  ]);
  return (
    <div className="space-y-5">
      <h1 className="text-lg font-semibold">{t("lessons.today")} · {formatDate(today)}</h1>
      {lessons.length === 0 && <p className="rounded-xl border border-line bg-white p-6 text-center text-sm text-zinc-500">{t("t.noLessons")}</p>}
      <ul className="space-y-3">
        {lessons.map((l) => (
          <li key={l.id}>
            <Link href={`/t/lessons/${l.id}`} className={cx("block rounded-xl border bg-white p-4 transition-colors active:bg-zinc-50", l.status === "SCHEDULED" && l.endTime <= nowTimeHHmm() ? "border-amber-300" : "border-line")}>
              <div className="flex items-center justify-between">
                <div className="tnum text-lg font-semibold tracking-[-0.01em]">{l.startTime}–{l.endTime}</div>
                {l.status === "CANCELLED" ? <Badge tone="red">{t("lesson.CANCELLED")}</Badge> : l._count.attendance > 0 ? <Badge tone="green">{t("t.marked")}</Badge> : l.startTime <= nowTimeHHmm() ? <Badge tone="amber">{t("t.notMarked")}</Badge> : <Badge>{t("lesson.SCHEDULED")}</Badge>}
              </div>
              <div className="mt-1 text-sm">{l.group.name} <span className="text-zinc-500">#{l.group.code}</span></div>
              <div className="text-xs text-zinc-500">{l.room?.name ?? ""} · {l.group._count.enrollments} {t("common.student").toLowerCase()}</div>
            </Link>
          </li>
        ))}
      </ul>
      {missing.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-amber-700">{t("t.missing")} ({missing.length})</h2>
          <ul className="space-y-2">
            {missing.map((l) => (
              <li key={l.id}><Link href={`/t/lessons/${l.id}`} className="flex min-h-[48px] items-center justify-between rounded-xl border border-line bg-white px-4 text-sm"><span>{formatDate(toISODate(l.date))} {l.startTime}</span><span className="text-zinc-500">{l.group.name}</span></Link></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
