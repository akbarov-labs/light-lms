import Link from "next/link";
import { ChevronRight } from "lucide-react";
import { requireCtx } from "@/lib/ctx";
import { db } from "@/lib/db";

/** Teacher: the groups they lead → each group's monthly report cards. */
export default async function TeacherReports() {
  const ctx = await requireCtx();
  const { t } = ctx;
  const groups = await db.group.findMany({ where: { centerId: ctx.centerId, teacherId: ctx.userId, status: { in: ["ACTIVE", "PLANNED", "FINISHED"] } }, select: { id: true, name: true, code: true, status: true }, orderBy: [{ status: "asc" }, { code: "desc" }] });
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
    </div>
  );
}
