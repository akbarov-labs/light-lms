import { Check, MessageSquare, Plus } from "lucide-react";
import Link from "next/link";
import type { LeadStage } from "@prisma/client";
import { requireStaff } from "@/lib/ctx";
import { db } from "@/lib/db";
import { formatDate, toISODate, todayISO } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { leadTone } from "@/lib/format";
import { Badge, LinkButton, PageHeader, cx } from "@/components/ui";
import { Input, Select } from "@/components/fields";
import { Modal } from "@/components/client";
import { LeadForm } from "./lead-form";

const STAGES: LeadStage[] = ["NEW", "CONTACTED", "TRIAL_BOOKED", "TRIAL_DONE", "ENROLLED", "LOST"];

export default async function LeadsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireStaff("leads");
  const { t } = ctx;
  const ids = ctx.activeBranchId ? [ctx.activeBranchId] : ctx.branchIds;
  const leads = await db.lead.findMany({
    where: {
      centerId: ctx.centerId,
      archivedAt: sp.archived ? { not: null } : null,
      ...(ids ? { OR: [{ branchId: { in: ids } }, { branchId: null }] } : {}),
      ...(sp.source ? { source: sp.source } : {}),
      ...(sp.assigned ? { assignedToId: sp.assigned } : {}),
      ...(sp.q ? { AND: [{ OR: [{ name: { contains: sp.q, mode: "insensitive" } }, { phone: { contains: sp.q.replace(/\D/g, "") || sp.q } }] }] } : {}),
    },
    include: { course: { select: { name: true } }, assignedTo: { select: { name: true } }, _count: { select: { notes: true } } },
    orderBy: [{ nextContactAt: { sort: "asc", nulls: "last" } }, { createdAt: "desc" }],
    take: 600,
  });
  const [sources, admins] = await Promise.all([
    db.lead.findMany({ where: { centerId: ctx.centerId, source: { not: null } }, distinct: ["source"], select: { source: true } }),
    db.user.findMany({ where: { centerId: ctx.centerId, role: { not: "TEACHER" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const today = todayISO();
  const appUrl = (process.env.APP_URL ?? "").replace(/\/$/, "");
  return (
    <>
      <PageHeader
        title={t("nav.leads")}
        subtitle={<span>{t("leads.publicForm")}: <a className="text-zinc-900 underline decoration-zinc-300 hover:decoration-zinc-900" href={`/f/${ctx.center.slug}`} target="_blank" rel="noreferrer">{appUrl}/f/{ctx.center.slug}</a></span>}
        actions={
          <>
            {ctx.can("export") && <LinkButton variant="secondary" href={`/api/export/leads?${new URLSearchParams(Object.entries(sp).filter(([, v]) => v) as [string, string][]).toString()}`}>{t("common.export")}</LinkButton>}
            <Modal label={t("leads.new")} icon={<Plus className="h-4 w-4" aria-hidden />} title={t("leads.new")} wide><LeadForm ctx={ctx} /></Modal>
          </>
        }
      />
      <form className="mb-4 flex flex-wrap items-center gap-2 *:w-full *:min-w-0 sm:*:w-auto">
        <Input name="q" type="search" defaultValue={sp.q} placeholder={t("common.search")} aria-label={t("common.search")} className="sm:w-64!" />
        <Select name="source" aria-label={t("common.source")} defaultValue={sp.source ?? ""}>
          <option value="">{t("common.source")}: {t("common.all")}</option>
          {sources.map((s) => <option key={s.source} value={s.source!}>{s.source}</option>)}
        </Select>
        <Select name="assigned" aria-label={t("leads.assigned")} defaultValue={sp.assigned ?? ""}>
          <option value="">{t("leads.assigned")}: {t("common.all")}</option>
          {admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
        </Select>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="archived" value="1" defaultChecked={!!sp.archived} className="h-4 w-4" /> {t("leads.showArchived")}</label>
        <button className="h-9 rounded-lg bg-zinc-900 px-3.5 text-sm font-medium text-white hover:bg-zinc-800">{t("common.filter")}</button>
      </form>
      <div className="flex gap-3 overflow-x-auto pb-4">
        {STAGES.map((stage) => {
          const col = leads.filter((l) => l.stage === stage);
          return (
            <section key={stage} className="w-64 shrink-0 rounded-xl bg-zinc-100/70 p-2">
              <header className="mb-2 flex items-center justify-between px-1">
                <Badge tone={leadTone[stage]}>{t(`lead.${stage}`)}</Badge>
                <span className="text-xs text-zinc-500">{col.length}</span>
              </header>
              <div className="space-y-2">
                {col.map((l) => {
                  const overdue = l.nextContactAt && toISODate(l.nextContactAt) <= today && stage !== "ENROLLED" && stage !== "LOST";
                  return (
                    <Link key={l.id} href={`/leads/${l.id}`} className="block rounded-lg border border-zinc-200 bg-white p-2.5 text-sm shadow-xs hover:border-accent">
                      <div className="font-medium text-zinc-900">{l.name}</div>
                      <div className="text-xs text-zinc-500">{formatPhone(l.phone)}</div>
                      {l.course && <div className="mt-1 text-xs text-zinc-600">{l.course.name}</div>}
                      <div className="mt-1 flex flex-wrap items-center gap-1 text-xs">
                        {l.source && <span className="text-zinc-500">{l.source}</span>}
                        {l.nextContactAt && <span className={cx(overdue ? "font-medium text-red-600" : "text-zinc-500")}>☎ {formatDate(l.nextContactAt)}</span>}
                        {l._count.notes > 0 && <span className="inline-flex items-center gap-0.5 text-zinc-500"><MessageSquare className="h-3 w-3" aria-hidden />{l._count.notes}</span>}
                        {l.studentId && <Check className="h-3.5 w-3.5 text-emerald-700" aria-label={t("leads.converted")} />}
                      </div>
                      {stage === "LOST" && l.lostReason && <div className="mt-1 text-xs text-zinc-500">{l.lostReason}</div>}
                    </Link>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
