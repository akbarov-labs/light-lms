import type { Student } from "@prisma/client";
import type { Ctx } from "@/lib/ctx";
import { db } from "@/lib/db";
import { toISODate } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { Card } from "@/components/ui";
import { Checkbox, Field, FormGrid, Input, Select, Textarea } from "@/components/fields";
import { ActionForm, SubmitButton } from "@/components/client";
import { createStudentAction, updateStudentAction } from "./actions";

export async function StudentForm({ ctx, student, prefill }: { ctx: Ctx; student?: Student; prefill?: { firstName?: string; lastName?: string; phone?: string; source?: string; leadId?: string; courseId?: string | null; guardianPhone?: string } }) {
  const { t } = ctx;
  const branches = await db.branch.findMany({ where: { centerId: ctx.centerId, archivedAt: null, ...(ctx.branchIds ? { id: { in: ctx.branchIds } } : {}) }, orderBy: { name: "asc" } });
  const groups = student
    ? []
    : await db.group.findMany({
        where: { centerId: ctx.centerId, status: { in: ["ACTIVE", "PLANNED"] }, ...(ctx.branchIds ? { branchId: { in: ctx.branchIds } } : {}), ...(prefill?.courseId ? { courseId: prefill.courseId } : {}) },
        include: { course: { select: { name: true } } },
        orderBy: { name: "asc" },
      });
  return (
    <ActionForm action={student ? updateStudentAction : createStudentAction} className="space-y-4">
      {student && <input type="hidden" name="id" value={student.id} />}
      {prefill?.leadId && <input type="hidden" name="leadId" value={prefill.leadId} />}
      <Card title={t("common.student")}>
        <FormGrid cols={3}>
          <Field label={t("students.lastName")}><Input name="lastName" defaultValue={student?.lastName ?? prefill?.lastName} required /></Field>
          <Field label={t("students.firstName")}><Input name="firstName" defaultValue={student?.firstName ?? prefill?.firstName} required /></Field>
          <Field label={t("common.phone")}><Input name="phone" type="tel" defaultValue={student?.phone ? formatPhone(student.phone) : (prefill?.phone ?? "")} placeholder="90 123 45 67" /></Field>
          <Field label={t("students.birthDate")}><Input type="date" name="birthDate" defaultValue={student?.birthDate ? toISODate(student.birthDate) : ""} /></Field>
          <Field label={t("students.gender")}>
            <Select name="gender" defaultValue={student?.gender ?? ""}>
              <option value="">—</option>
              <option value="M">{t("gender.M")}</option>
              <option value="F">{t("gender.F")}</option>
            </Select>
          </Field>
          <Field label={t("common.branch")}>
            <Select name="branchId" defaultValue={student?.branchId ?? ctx.activeBranchId ?? branches[0]?.id}>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
          <Field label={t("common.source")}><Input name="source" defaultValue={student?.source ?? prefill?.source ?? ""} placeholder="Instagram, Telegram, tanish…" /></Field>
          <Field label={t("common.tags")} className="sm:col-span-2"><Input name="tags" defaultValue={student?.tags.join(", ") ?? ""} placeholder="IELTS, VIP" /></Field>
        </FormGrid>
        <Field label={t("common.notes")} className="mt-3"><Textarea name="notes" defaultValue={student?.notes ?? ""} /></Field>
      </Card>
      {!student && (
        <Card title={t("students.guardian")}>
          <FormGrid cols={3}>
            <Field label={t("students.guardianName")}><Input name="guardianName" /></Field>
            <Field label={t("students.guardianPhone")}><Input name="guardianPhone" type="tel" defaultValue={prefill?.guardianPhone ?? ""} placeholder="90 123 45 67" /></Field>
            <Field label={t("students.relation")}>
              <Select name="relation" defaultValue="mother">
                <option value="mother">{t("students.relation.mother")}</option>
                <option value="father">{t("students.relation.father")}</option>
                <option value="other">{t("students.relation.other")}</option>
              </Select>
            </Field>
          </FormGrid>
          <p className="mt-2 text-xs text-slate-500">{t("students.siblingHint")}</p>
        </Card>
      )}
      {!student && groups.length > 0 && (
        <Card title={t("students.enrollNow")}>
          <FormGrid>
            <Field label={t("common.group")}>
              <Select name="groupId" defaultValue="">
                <option value="">—</option>
                {groups.map((g) => <option key={g.id} value={g.id}>{g.name} #{g.code} · {g.course.name}</option>)}
              </Select>
            </Field>
            <div className="pt-6"><Checkbox name="trial" label={t("groups.trial")} defaultChecked /></div>
          </FormGrid>
        </Card>
      )}
      <div className="flex justify-end"><SubmitButton>{student ? t("common.save") : t("common.create")}</SubmitButton></div>
    </ActionForm>
  );
}
