import Link from "next/link";
import { requireCtx } from "@/lib/ctx";
import { db } from "@/lib/db";
import { addDays, formatDate, fromISODate, toISODate, todayISO, weekdayOf } from "@/lib/dates";
import { Badge } from "@/components/ui";

export default async function TeacherWeek() {
  const ctx = await requireCtx();
  const { t } = ctx;
  const today = todayISO();
  const lessons = await db.lesson.findMany({
    where: { teacherId: ctx.userId, date: { gte: fromISODate(today), lte: fromISODate(addDays(today, 6)) } },
    include: { group: { select: { name: true, code: true } }, room: { select: { name: true } } },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });
  const days = Array.from({ length: 7 }, (_, i) => addDays(today, i));
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">{t("t.week")}</h1>
      {days.map((d) => {
        const list = lessons.filter((l) => toISODate(l.date) === d);
        if (list.length === 0) return null;
        return (
          <section key={d}>
            <h2 className="mb-2 text-sm font-semibold text-zinc-600">{t(`common.weekday.${weekdayOf(d)}` as "common.weekday.1")}, {formatDate(d)}</h2>
            <ul className="space-y-2">
              {list.map((l) => (
                <li key={l.id}>
                  <Link href={`/t/lessons/${l.id}`} className="flex items-center justify-between rounded-lg bg-white p-3 text-sm shadow-sm">
                    <span className="font-medium">{l.startTime}–{l.endTime}</span>
                    <span className="truncate px-2">{l.group.name}{l.room ? ` · ${l.room.name}` : ""}</span>
                    {l.status === "CANCELLED" && <Badge tone="red">{t("lesson.CANCELLED")}</Badge>}
                  </Link>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {lessons.length === 0 && <p className="text-center text-sm text-zinc-500">{t("t.noLessons")}</p>}
    </div>
  );
}
