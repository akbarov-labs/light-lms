import type { Lead } from "@/generated/prisma/client";
import type { Ctx } from "@/lib/ctx";
import { db } from "@/lib/db";
import { toISODate } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { Field, FormGrid, Input, Select, Textarea } from "@/components/fields";
import { ModalForm, SubmitButton } from "@/components/client";
import { saveLeadAction } from "./actions";

export async function LeadForm({ ctx, lead }: { ctx: Ctx; lead?: Lead }) {
  const { t } = ctx;
  const [courses, branches, admins] = await Promise.all([
    db.course.findMany({ where: { centerId: ctx.centerId, archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.branch.findMany({ where: { centerId: ctx.centerId, archivedAt: null, ...(ctx.branchIds ? { id: { in: ctx.branchIds } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
    db.user.findMany({ where: { centerId: ctx.centerId, archivedAt: null, role: { not: "TEACHER" } }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  return (
    <ModalForm action={saveLeadAction} className="space-y-3">
      {lead && <input type="hidden" name="id" value={lead.id} />}
      <FormGrid>
        <Field label={t("common.fullName")}><Input name="name" defaultValue={lead?.name} required /></Field>
        <Field label={t("common.phone")}><Input name="phone" type="tel" defaultValue={lead ? formatPhone(lead.phone) : ""} required /></Field>
        <Field label={t("common.source")}><Input name="source" defaultValue={lead?.source ?? ""} list="lead-sources" /><datalist id="lead-sources">{["Instagram", "Telegram", "Facebook", "Tanish", "Qo'ng'iroq", "Banner", "Sayt formasi"].map((s) => <option key={s} value={s} />)}</datalist></Field>
        <Field label={t("leads.interestedCourse")}>
          <Select name="courseId" defaultValue={lead?.courseId ?? ""}>
            <option value="">—</option>
            {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </Select>
        </Field>
        <Field label={t("common.branch")}>
          <Select name="branchId" defaultValue={lead?.branchId ?? ctx.activeBranchId ?? ""}>
            {!ctx.branchIds && <option value="">—</option>}
            {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
          </Select>
        </Field>
        <Field label={t("leads.assigned")}>
          <Select name="assignedToId" defaultValue={lead?.assignedToId ?? ctx.userId}>
            <option value="">—</option>
            {admins.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
          </Select>
        </Field>
        <Field label={t("leads.nextContact")}><Input type="date" name="nextContactAt" defaultValue={lead?.nextContactAt ? toISODate(lead.nextContactAt) : ""} /></Field>
        <Field label={t("common.tags")}><Input name="tags" defaultValue={lead?.tags.join(", ") ?? ""} /></Field>
      </FormGrid>
      {!lead && <Field label={t("common.note")}><Textarea name="note" /></Field>}
      <SubmitButton>{lead ? t("common.save") : t("common.create")}</SubmitButton>
    </ModalForm>
  );
}
