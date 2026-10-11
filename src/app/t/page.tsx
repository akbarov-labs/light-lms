import Link from "next/link";
import { requireCtx } from "@/lib/ctx";
import { db } from "@/lib/db";
import { addDays, formatDate, fromISODate, toISODate, todayISO } from "@/lib/dates";
import { Badge, cx } from "@/components/ui";

export default async function TeacherToday() {
  const ctx = await requireCtx();
  const { t } = ctx;
  const today = todayISO();
  const [lessons, missing] = await Promise.all([
    db.lesson.findMany({
      where: { teacherId: ctx.userId, date: fromISODate(today) },
      include: { group: { select: { name: true, code: true, _count: { select: { enrollments: { where: { endDate: null } } } } } }, room: { select: { name: true } }, _count: { select: { attendance: true } } },
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
      {lessons.length === 0 && <p className="rounded-xl bg-white p-6 text-center text-sm text-slate-500 shadow-sm">{t("t.noLessons")}</p>}
      <ul className="space-y-3">
        {lessons.map((l) => (
          <li key={l.id}>
            <Link href={`/t/lessons/${l.id}`} className={cx("block rounded-xl border bg-white p-4 shadow-sm active:scale-[0.99]", l.status === "SCHEDULED" ? "border-amber-300" : "border-slate-200")}>
              <div className="flex items-center justify-between">
                <div className="text-lg font-semibold">{l.startTime}–{l.endTime}</div>
                {l.status === "CANCELLED" ? <Badge tone="red">{t("lesson.CANCELLED")}</Badge> : l._count.attendance > 0 ? <Badge tone="green">{t("t.marked")} ✓</Badge> : <Badge tone="amber">{t("t.notMarked")}</Badge>}
              </div>
              <div className="mt-1 text-sm">{l.group.name} <span className="text-slate-400">#{l.group.code}</span></div>
              <div className="text-xs text-slate-500">{l.room?.name ?? ""} · {l.group._count.enrollments} {t("common.students").toLowerCase()}</div>
            </Link>
          </li>
        ))}
      </ul>
      {missing.length > 0 && (
        <section>
          <h2 className="mb-2 text-sm font-semibold text-amber-700">{t("t.missing")} ({missing.length})</h2>
          <ul className="space-y-2">
            {missing.map((l) => (
              <li key={l.id}><Link href={`/t/lessons/${l.id}`} className="flex justify-between rounded-lg bg-white p-3 text-sm shadow-sm"><span>{formatDate(toISODate(l.date))} {l.startTime}</span><span className="text-slate-500">{l.group.name}</span></Link></li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
