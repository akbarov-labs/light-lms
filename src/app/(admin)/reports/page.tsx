import Link from "next/link";
import { requireStaff } from "@/lib/ctx";
import { db } from "@/lib/db";
import { formatDate, isISODate, monthRange, todayISO } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { attendanceStats, billedByGroup, debtAging, expenseTotals, leadFunnel, revenue, studentStats } from "@/lib/queries/reports";
import { Card, EmptyState, PageHeader, Stat, Table, Td, Th, Tr } from "@/components/ui";
import { Input } from "@/components/fields";
import { ShareBars } from "@/components/bar-chart";

export default async function ReportsPage({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const sp = await searchParams;
  const ctx = await requireStaff("finance.view");
  const { t } = ctx;
  const m = monthRange(todayISO().slice(0, 7));
  const p = { from: isISODate(sp.from) ? sp.from : m.start, to: isISODate(sp.to) ? sp.to : m.end };
  const [rev, exp, billed, aging, students, funnel, att, branches] = await Promise.all([
    revenue(ctx, p),
    expenseTotals(ctx, p),
    billedByGroup(ctx, p),
    debtAging(ctx),
    studentStats(ctx, p),
    leadFunnel(ctx, p),
    attendanceStats(ctx, p),
    db.branch.findMany({ where: { centerId: ctx.centerId }, select: { id: true, name: true } }),
  ]);
  const bname = new Map(branches.map((b) => [b.id, b.name]));
  const branchLabel = (id: string) => (id === "-" ? t("reports.unknown") : (bname.get(id) ?? id));
  return (
    <>
      <PageHeader title={t("nav.reports")} subtitle={`${formatDate(p.from)} – ${formatDate(p.to)}`} />
      <form className="mb-4 flex flex-wrap items-center gap-2 [&>*]:w-full [&>*]:min-w-0 sm:[&>*]:w-auto">
        <Input type="date" aria-label={t("common.from")} name="from" defaultValue={p.from} className="w-auto" />
        <Input type="date" aria-label={t("common.to")} name="to" defaultValue={p.to} className="w-auto" />
        <button className="h-9 rounded-lg bg-zinc-900 px-3.5 text-sm font-medium text-white hover:bg-zinc-800">{t("common.filter")}</button>
      </form>
      <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Stat label={t("reports.revenue")} value={formatMoney(rev.total)} />
        <Stat label={t("reports.expenses")} value={formatMoney(exp.total)} />
        <Stat label={t("reports.profit")} value={formatMoney(rev.total - exp.total)} tone={rev.total - exp.total < 0 ? "red" : "green"} />
        <Stat label={t("reports.totalDebt")} value={formatMoney(aging.total)} tone={aging.total > 0 ? "red" : undefined} href="/debtors" />
      </div>
      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card title={t("reports.byMethod")}><ShareBars rows={[...rev.byMethod.entries()].map(([k, v]) => ({ label: t(`method.${k as "CASH"}`), value: v }))} /></Card>
        <Card title={`${t("reports.revenue")} · ${t("reports.byBranch")}`}><ShareBars rows={[...rev.byBranch.entries()].map(([k, v]) => ({ label: branchLabel(k), value: v }))} /></Card>
        <Card title={`${t("reports.expenses")} · ${t("reports.byCategory")}`}><ShareBars rows={[...exp.byCategory.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ label: k, value: v }))} /></Card>
      </div>
      <div className="mb-4 grid gap-4 lg:grid-cols-3">
        <Card title={t("reports.debtAging")}>
          <ShareBars rows={[0, 1, 2].map((i) => ({ label: t(`reports.aging.${i}` as "reports.aging.0"), value: aging.buckets[i] }))} />
        </Card>
        <Card title={t("reports.students")}>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><div className="text-zinc-500">{t("reports.active")}</div><div className="text-xl font-semibold">{students.active}</div></div>
            <div><div className="text-zinc-500">{t("reports.new")}</div><div className="text-xl font-semibold text-emerald-700">+{students.newStudents}</div></div>
            <div><div className="text-zinc-500">{t("reports.left")}</div><div className="text-xl font-semibold text-red-600">−{students.left}</div></div>
            <div><div className="text-zinc-500">{t("reports.conversion")}</div><div className="text-xl font-semibold">{students.trialsActivated}/{students.trials}{students.trials ? ` (${Math.round((students.trialsActivated / students.trials) * 100)}%)` : ""}</div></div>
          </div>
          {students.leftReasons.length > 0 && (
            <div className="mt-3 border-t border-zinc-100 pt-2 text-xs">
              <div className="mb-1 text-zinc-500">{t("reports.leftReasons")}</div>
              {students.leftReasons.map(([r, n]) => <div key={r} className="flex justify-between"><span>{r}</span><span>{n}</span></div>)}
            </div>
          )}
        </Card>
        <Card title={`${t("reports.funnel")} (${funnel.total} · ${funnel.conversion}%)`}>
          <ShareBars money={false} rows={(["NEW", "CONTACTED", "TRIAL_BOOKED", "TRIAL_DONE", "ENROLLED", "LOST"] as const).map((k) => ({ label: t(`lead.${k}`), value: funnel.byStage.find(([s]) => s === k)?.[1] ?? 0 }))} />
          {funnel.bySource.length > 0 && <div className="mt-3 border-t border-zinc-100 pt-2 text-xs"><div className="mb-1 text-zinc-500">{t("reports.bySource")}</div>{funnel.bySource.map(([k, v]) => <div key={k} className="flex justify-between"><span>{k}</span><span>{v}</span></div>)}</div>}
          {funnel.byAdmin.length > 0 && <div className="mt-2 text-xs"><div className="mb-1 text-zinc-500">{t("reports.byAdmin")}</div>{funnel.byAdmin.map(([k, v]) => <div key={k} className="flex justify-between"><span>{k}</span><span>{v}</span></div>)}</div>}
          {funnel.lostReasons.length > 0 && <div className="mt-2 text-xs"><div className="mb-1 text-zinc-500">{t("reports.lostReasons")}</div>{funnel.lostReasons.map(([k, v]) => <div key={k} className="flex justify-between"><span>{k}</span><span>{v}</span></div>)}</div>}
        </Card>
      </div>
      <Card className="mb-4" pad={false} title={t("reports.billedBy")}>
        {billed.length === 0 ? <EmptyState>{t("common.empty")}</EmptyState> : (
          <Table>
            <thead><tr><Th>{t("common.group")}</Th><Th>{t("common.course")}</Th><Th>{t("common.teacher")}</Th><Th className="text-right">{t("reports.billed")}</Th></tr></thead>
            <tbody>{billed.map((g) => <Tr key={g.name}><Td>{g.name}</Td><Td>{g.course}</Td><Td>{g.teacher}</Td><Td className="whitespace-nowrap text-right font-medium">{formatMoney(g.billed)}</Td></Tr>)}</tbody>
          </Table>
        )}
      </Card>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card pad={false} title={`${t("reports.attendance")} · ${t("common.groups")}`}>
          <Table><tbody>{att.byGroup.map((g) => <Tr key={g.name}><Td className="text-sm">{g.name}</Td><Td className="text-right font-medium">{g.rate}%</Td></Tr>)}</tbody></Table>
        </Card>
        <Card pad={false} title={`${t("reports.attendance")} · ${t("common.teacher")}`}>
          <Table><tbody>{att.byTeacher.map((g) => <Tr key={g.name}><Td className="text-sm">{g.name}</Td><Td className="text-right font-medium">{g.rate}%</Td></Tr>)}</tbody></Table>
        </Card>
        <Card pad={false} title={`${t("reports.missing")} (${att.missing.length})`}>
          <Table><tbody>{att.missing.slice(0, 30).map((l) => <Tr key={l.id}><Td className="whitespace-nowrap text-xs"><Link href={`/lessons/${l.id}`} className="text-zinc-900 underline decoration-zinc-300 hover:decoration-zinc-900">{formatDate(l.date)} {l.time}</Link></Td><Td className="text-xs">{l.group}</Td><Td className="text-xs">{l.teacher}</Td></Tr>)}</tbody></Table>
        </Card>
      </div>
    </>
  );
}
