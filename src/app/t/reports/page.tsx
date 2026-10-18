import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireCtx } from "@/lib/ctx";
import { db } from "@/lib/db";
import { formatDate, toISODate } from "@/lib/dates";

/** Teacher: the groups they lead → each group's monthly report cards. */
export default async function TeacherReports() {
  const ctx = await requireCtx();
  const { t } = ctx;
  const [groups, exams] = await Promise.all([
    db.group.findMany({ where: { centerId: ctx.centerId, teacherId: ctx.userId, status: { in: ["ACTIVE", "PLANNED", "FINISHED"] } }, select: { id: true, name: true, code: true, status: true }, orderBy: [{ status: "asc" }, { code: "desc" }] }),
    db.exam.findMany({ where: { centerId: ctx.centerId, archivedAt: null, group: { teacherId: ctx.userId } }, select: { id: true, title: true, date: true, group: { select: { name: true } }, _count: { select: { results: true } } }, orderBy: { date: "desc" }, take: 20 }),
  ]);
  return (
    <div className="space-y-4">
      <h1 className="text-lg font-semibold">{t("rc.cards")}</h1>
      {groups.length === 0 && <p className="rounded-xl border border-line bg-white p-6 text-center text-sm text-zinc-500">{t("rc.none")}</p>}
      <ul className="space-y-2">
        {groups.map((g) => (
          <li key={g.id}>
            <Link href={`/t/reports/${g.id}`} className="flex min-h-[52px] items-center justify-between rounded-xl border border-line bg-white px-4 text-sm active:bg-zinc-50">
              <span>{g.name} <span className="text-zinc-500">#{g.code}</span></span>
              <ChevronRight className="h-4 w-4 text-zinc-400" aria-hidden />
            </Link>
          </li>
        ))}
      </ul>
      {exams.length > 0 && (
        <section className="space-y-2 pt-2">
          <h2 className="text-sm font-semibold">{t("exams.forGroups")}</h2>
          <ul className="space-y-2">
            {exams.map((e) => (
              <li key={e.id}>
                <Link href={`/t/exams/${e.id}`} className="flex min-h-[52px] items-center justify-between gap-3 rounded-xl border border-line bg-white px-4 text-sm active:bg-zinc-50">
                  <span className="min-w-0 truncate">{e.title} <span className="text-zinc-500">· {e.group?.name}</span></span>
                  <span className="tnum shrink-0 text-xs text-zinc-500">{formatDate(toISODate(e.date)).slice(0, 5)} · {e._count.results}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
