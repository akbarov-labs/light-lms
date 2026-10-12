import Link from "next/link";
import { redirect } from "next/navigation";
import { requireCtx } from "@/lib/ctx";
import { db } from "@/lib/db";
import { fromISODate, monthLabel, monthRange, shiftMonth, todayISO } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { attendanceStats, debtAging, revenue, revenueByMonth, studentStats } from "@/lib/queries/reports";
import { Card, PageHeader, Stat, Table, Td, Th, Tr } from "@/components/ui";
import { BarChart } from "@/components/bar-chart";
import { OwnerNotices } from "@/components/setup-banner";

export default async function Dashboard() {
  const ctx = await requireCtx();
  if (ctx.role === "TEACHER") redirect("/t");
  if (!ctx.can("finance.view")) redirect("/today");
  const { t } = ctx;
  const month = todayISO().slice(0, 7);
  const cur = monthRange(month);
  const prev = monthRange(shiftMonth(month, -1));
  const [revNow, revPrev, aging, students, att, chart, branches, teachers] = await Promise.all([
    revenue(ctx, { from: cur.start, to: cur.end }),
    revenue(ctx, { from: prev.start, to: prev.end }),
    debtAging(ctx),
    studentStats(ctx, { from: cur.start, to: cur.end }),
    attendanceStats(ctx, { from: cur.start, to: cur.end }),
    revenueByMonth(ctx, 6),
    db.branch.findMany({
      where: { centerId: ctx.centerId, archivedAt: null, ...(ctx.branchIds ? { id: { in: ctx.branchIds } } : {}) },
      include: { _count: { select: { groups: { where: { status: { in: ["ACTIVE", "PLANNED"] } } } } } },
      orderBy: { name: "asc" },
    }),
    db.user.findMany({
      where: { centerId: ctx.centerId, archivedAt: null, OR: [{ isTeacher: true }, { role: "TEACHER" }] },
      include: {
        groups: { where: { status: { in: ["ACTIVE", "PLANNED"] }, ...(ctx.activeBranchId ? { branchId: ctx.activeBranchId } : ctx.branchIds ? { branchId: { in: ctx.branchIds } } : {}) }, include: { _count: { select: { enrollments: { where: { endDate: null, status: { in: ["ACTIVE", "FROZEN", "TRIAL"] } } } } } } },
        _count: { select: { lessons: { where: { status: "HELD", date: { gte: fromISODate(cur.start), lte: fromISODate(cur.end) } } } } },
      },
      orderBy: { name: "asc" },
    }),
  ]);
  const activeByBranch = await db.enrollment.groupBy({ by: ["groupId"], where: { endDate: null, status: { in: ["ACTIVE", "FROZEN"] }, group: { centerId: ctx.centerId } }, _count: true });
  const groupBranch = new Map((await db.group.findMany({ where: { centerId: ctx.centerId }, select: { id: true, branchId: true } })).map((g) => [g.id, g.branchId]));
  const studentsPerBranch = new Map<string, number>();
  for (const r of activeByBranch) {
    const b = groupBranch.get(r.groupId)!;
    studentsPerBranch.set(b, (studentsPerBranch.get(b) ?? 0) + r._count);
  }
  const delta = revPrev.total ? Math.round(((revNow.total - revPrev.total) / Math.abs(revPrev.total)) * 100) : null;
  const attByTeacher = new Map(att.byTeacher.map((x) => [x.name, x.rate]));
  const missingByTeacher = new Map<string, number>();
  for (const l of att.missing) missingByTeacher.set(l.teacher, (missingByTeacher.get(l.teacher) ?? 0) + 1);
  const conv = students.trials ? Math.round((students.trialsActivated / students.trials) * 100) : null;
  return (
    <>
      <PageHeader title={t("nav.dashboard")} subtitle={ctx.center.name} />
      <OwnerNotices ctx={ctx} />
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label={`${t("reports.revenue")} · ${t("reports.thisMonth")}`} value={formatMoney(revNow.total)} hint={`${t("reports.lastMonth")}: ${formatMoney(revPrev.total)}${delta !== null ? ` (${delta > 0 ? "+" : ""}${delta}%)` : ""}`} href="/payments" />
        <Stat label={t("reports.totalDebt")} value={formatMoney(aging.total)} tone={aging.total > 0 ? "red" : undefined} hint={t("dash.debtFamilies", { n: aging.families })} href="/debtors" />
        <Stat label={t("reports.active")} value={students.active} hint={t("dash.newLeft", { a: students.newStudents, b: students.left })} href="/students" />
        <Stat label={t("reports.conversion")} value={conv !== null ? `${conv}%` : "—"} hint={`${students.trialsActivated}/${students.trials}`} />
      </div>
      <div className="mb-4 grid gap-4 lg:grid-cols-3 [&>*]:min-w-0">
        <Card className="lg:col-span-2" title={t("reports.revenueChart")}>
          <BarChart units={{ mln: t("chart.mln"), k: t("chart.k") }} data={chart.map((c) => ({ label: monthLabel(c.month, ctx.locale).split(" ")[0], value: c.total }))} />
        </Card>
        <Card title={t("reports.missing")}>
          <div className="tnum text-[28px] font-semibold tracking-[-0.02em] text-zinc-950">{att.missing.length}</div>
          <ul className="mt-2 space-y-1 text-sm">
            {att.missing.slice(0, 6).map((l) => <li key={l.id}><Link href={`/lessons/${l.id}`} className="text-zinc-900 underline decoration-zinc-300 hover:decoration-zinc-900">{l.date.slice(8)}.{l.date.slice(5, 7)} {l.time}</Link> · {l.group}</li>)}
          </ul>
        </Card>
      </div>
      <div className="grid gap-4 xl:grid-cols-2 [&>*]:min-w-0">
        <Card pad={false} title={t("reports.byBranch")}>
          <Table>
            <thead><tr><Th>{t("common.branch")}</Th><Th className="text-right">{t("common.groups")}</Th><Th className="text-right">{t("reports.active")}</Th><Th className="text-right">{t("reports.thisMonth")}</Th></tr></thead>
            <tbody>
              {branches.map((b) => (
                <Tr key={b.id}><Td>{b.name}</Td><Td className="text-right">{b._count.groups}</Td><Td className="text-right">{studentsPerBranch.get(b.id) ?? 0}</Td><Td className="whitespace-nowrap text-right font-medium">{formatMoney(revNow.byBranch.get(b.id) ?? 0)}</Td></Tr>
              ))}
            </tbody>
          </Table>
        </Card>
        <Card pad={false} title={t("reports.teacherLoad")}>
          <Table>
            <thead><tr><Th>{t("common.teacher")}</Th><Th className="text-right">{t("common.groups")}</Th><Th className="text-right">{t("common.students")}</Th><Th className="text-right">{t("reports.lessonsMonth")}</Th><Th className="text-right">{t("dash.attendanceRate")}</Th><Th className="text-right">{t("dash.missingShort")}</Th></tr></thead>
            <tbody>
              {teachers.filter((u) => u.groups.length > 0 || u._count.lessons > 0).map((u) => (
                <Tr key={u.id}>
                  <Td><Link href={`/salary/${u.id}`} className="hover:underline hover:decoration-zinc-400">{u.name}</Link></Td>
                  <Td className="text-right">{u.groups.length}</Td>
                  <Td className="text-right">{u.groups.reduce((s, g) => s + g._count.enrollments, 0)}</Td>
                  <Td className="text-right">{u._count.lessons}</Td>
                  <Td className="text-right">{attByTeacher.has(u.name) ? `${attByTeacher.get(u.name)}%` : "—"}</Td>
                  <Td className="text-right text-amber-700">{missingByTeacher.get(u.name) ?? ""}</Td>
                </Tr>
              ))}
            </tbody>
          </Table>
        </Card>
      </div>
    </>
  );
}
