import Link from "next/link";
import { notFound } from "next/navigation";
import type { LeadStage } from "@prisma/client";
import { canAccessBranch, requireStaff } from "@/lib/ctx";
import { db } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { fullName, leadTone } from "@/lib/format";
import { Badge, Card, KV, LinkButton, PageHeader } from "@/components/ui";
import { Field, Input, Select, Textarea } from "@/components/fields";
import { ActionForm, Modal, SubmitButton } from "@/components/client";
import { LeadForm } from "../lead-form";
import { addLeadNoteAction, moveLeadAction, toggleLeadArchiveAction } from "../actions";

const STAGES: LeadStage[] = ["NEW", "CONTACTED", "TRIAL_BOOKED", "TRIAL_DONE", "ENROLLED", "LOST"];

export default async function LeadPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireStaff("leads");
  const { t } = ctx;
  const lead = await db.lead.findFirst({
    where: { id, centerId: ctx.centerId },
    include: { course: true, branch: true, assignedTo: true, student: true, notes: { orderBy: { createdAt: "desc" } } },
  });
  if (!lead || (lead.branchId && !canAccessBranch(ctx, lead.branchId))) notFound();
  const authors = new Map((await db.user.findMany({ where: { id: { in: lead.notes.map((n) => n.createdById).filter(Boolean) as string[] } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
  const utm = lead.utm && typeof lead.utm === "object" ? Object.entries(lead.utm as Record<string, string>) : [];
  return (
    <>
      <PageHeader
        back={{ href: "/leads", label: t("nav.leads") }}
        title={lead.name}
        subtitle={<span className="flex items-center gap-2"><Badge tone={leadTone[lead.stage]}>{t(`lead.${lead.stage}`)}</Badge>{lead.archivedAt && <Badge>{t("settings.archived")}</Badge>}</span>}
        actions={
          <>
            {lead.student ? (
              <LinkButton variant="secondary" href={`/students/${lead.student.id}`}>{t("leads.converted")}: {fullName(lead.student)}</LinkButton>
            ) : (
              ctx.can("students.edit") && <LinkButton href={`/students/new?leadId=${lead.id}`}>{t("leads.convert")}</LinkButton>
            )}
            <Modal label={t("common.edit")} title={lead.name} variant="secondary" wide><LeadForm ctx={ctx} lead={lead} /></Modal>
            <ActionForm action={toggleLeadArchiveAction}>
              <input type="hidden" name="id" value={lead.id} />
              <SubmitButton variant="ghost">{lead.archivedAt ? t("common.restore") : t("common.archive")}</SubmitButton>
            </ActionForm>
          </>
        }
      />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4">
          <Card>
            <KV
              items={[
                [t("common.phone"), <a key="p" href={`tel:+${lead.phone}`} className="text-accent">{formatPhone(lead.phone)}</a>],
                [t("common.source"), lead.source ?? "—"],
                [t("leads.interestedCourse"), lead.course?.name ?? "—"],
                [t("common.branch"), lead.branch?.name ?? "—"],
                [t("leads.assigned"), lead.assignedTo?.name ?? "—"],
                [t("leads.nextContact"), formatDate(lead.nextContactAt)],
                [t("common.createdAt"), formatDateTime(lead.createdAt)],
                ...(lead.tags.length ? [[t("common.tags"), lead.tags.join(", ")] as [string, string]] : []),
                ...utm.map(([k, v]) => [k, v] as [string, string]),
              ]}
            />
          </Card>
          <Card title={t("leads.moveTo")}>
            <ActionForm action={moveLeadAction} className="space-y-2">
              <input type="hidden" name="id" value={lead.id} />
              <Select name="stage" defaultValue={lead.stage}>
                {STAGES.map((s) => <option key={s} value={s}>{t(`lead.${s}`)}</option>)}
              </Select>
              <Input name="lostReason" placeholder={t("leads.lostReason")} defaultValue={lead.lostReason ?? ""} />
              <SubmitButton variant="secondary">{t("common.save")}</SubmitButton>
            </ActionForm>
          </Card>
        </div>
        <Card className="lg:col-span-2" title={t("leads.history")}>
          <ActionForm action={addLeadNoteAction} reset className="mb-4 space-y-2">
            <input type="hidden" name="id" value={lead.id} />
            <Textarea name="text" required placeholder={t("leads.addNote")} />
            <div className="flex flex-wrap items-end gap-2">
              <Field label={t("leads.nextContact")}><Input type="date" name="nextContactAt" /></Field>
              <SubmitButton>{t("leads.addNote")}</SubmitButton>
            </div>
          </ActionForm>
          <ul className="space-y-3">
            {lead.notes.map((n) => (
              <li key={n.id} className="rounded-lg bg-slate-50 p-3 text-sm">
                <div className="whitespace-pre-line text-slate-800">{n.text}</div>
                <div className="mt-1 text-xs text-slate-500">{formatDateTime(n.createdAt)} · {n.createdById ? authors.get(n.createdById) : t("leads.formSource")}</div>
              </li>
            ))}
          </ul>
          {lead.student && <p className="mt-3 text-sm"><Link className="text-accent" href={`/students/${lead.student.id}`}>{fullName(lead.student)} →</Link></p>}
        </Card>
      </div>
    </>
  );
}
