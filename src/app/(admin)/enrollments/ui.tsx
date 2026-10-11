import type { Ctx } from "@/lib/ctx";
import { todayISO } from "@/lib/dates";
import { Field, FormGrid, Input, Select } from "@/components/fields";
import { Modal, ModalForm, SubmitButton } from "@/components/client";
import { StudentIdBridge } from "./student-id-bridge";
import { activateAction, enrollAction, freezeAction, leaveAction, termsAction, transferAction } from "./actions";

export interface EnrollmentLite {
  id: string;
  status: string;
  endDate: Date | null;
  groupId: string;
  priceOverride: number | null;
  discountPercent: number | null;
  discountAmount: number | null;
  discountUntil: Date | null;
  discountReason: string | null;
}

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : "");

/** Activate / transfer / freeze / leave / price buttons for one open enrollment. */
export function EnrollmentActions({ ctx, e, groups }: { ctx: Ctx; e: EnrollmentLite; groups: { id: string; name: string; code: number }[] }) {
  const { t } = ctx;
  if (!ctx.can("students.edit") || e.endDate) return null;
  const today = todayISO();
  return (
    <div className="flex flex-wrap justify-end gap-1">
      {e.status === "TRIAL" && (
        <Modal label={t("enr.activate")} title={t("enr.activate")} size="sm">
          <ModalForm action={activateAction} className="space-y-3">
            <input type="hidden" name="enrollmentId" value={e.id} />
            <Field label={t("enr.activateDate")} hint={t("enr.activateHint")}><Input type="date" name="date" /></Field>
            <SubmitButton>{t("enr.activate")}</SubmitButton>
          </ModalForm>
        </Modal>
      )}
      <Modal label={t("enr.transfer")} title={t("enr.transfer")} variant="secondary" size="sm">
        <ModalForm action={transferAction} className="space-y-3">
          <input type="hidden" name="enrollmentId" value={e.id} />
          <Field label={t("enr.transferTo")}>
            <Select name="toGroupId" required>
              {groups.filter((g) => g.id !== e.groupId).map((g) => <option key={g.id} value={g.id}>{g.name} (#{g.code})</option>)}
            </Select>
          </Field>
          <Field label={t("enr.moveDate")}><Input type="date" name="moveDate" defaultValue={today} required /></Field>
          <p className="text-xs text-slate-500">{t("enr.transferHint")}</p>
          <SubmitButton>{t("enr.transfer")}</SubmitButton>
        </ModalForm>
      </Modal>
      <Modal label={t("enr.freeze")} title={t("enr.freeze")} variant="secondary" size="sm">
        <ModalForm action={freezeAction} className="space-y-3">
          <input type="hidden" name="enrollmentId" value={e.id} />
          <FormGrid>
            <Field label={t("common.from")}><Input type="date" name="from" defaultValue={today} required /></Field>
            <Field label={t("common.to")}><Input type="date" name="to" required /></Field>
          </FormGrid>
          <Field label={t("common.reason")}><Input name="reason" /></Field>
          <p className="text-xs text-slate-500">{t("enr.freezeHint")}</p>
          <SubmitButton>{t("enr.freeze")}</SubmitButton>
        </ModalForm>
      </Modal>
      <Modal label={t("enr.terms")} title={t("enr.terms")} variant="secondary" size="sm">
        <ModalForm action={termsAction} className="space-y-3">
          <input type="hidden" name="enrollmentId" value={e.id} />
          <Field label={t("enr.priceOverride")} hint={t("common.optional")}><Input name="priceOverride" inputMode="numeric" defaultValue={e.priceOverride ?? ""} /></Field>
          <FormGrid>
            <Field label={t("enr.discountPercent")}><Input name="discountPercent" type="number" min={0} max={100} defaultValue={e.discountPercent ?? ""} /></Field>
            <Field label={t("enr.discountAmount")}><Input name="discountAmount" inputMode="numeric" defaultValue={e.discountAmount ?? ""} /></Field>
            <Field label={t("enr.discountUntil")}><Input type="date" name="discountUntil" defaultValue={iso(e.discountUntil)} /></Field>
            <Field label={t("enr.discountReason")}><Input name="discountReason" defaultValue={e.discountReason ?? ""} /></Field>
          </FormGrid>
          <SubmitButton>{t("common.save")}</SubmitButton>
        </ModalForm>
      </Modal>
      <Modal label={t("enr.leave")} title={t("enr.leave")} variant="ghost" size="sm">
        <ModalForm action={leaveAction} className="space-y-3">
          <input type="hidden" name="enrollmentId" value={e.id} />
          <Field label={t("enr.leaveDate")}><Input type="date" name="endDate" defaultValue={today} required /></Field>
          <Field label={t("enr.leftReason")}><Input name="reason" /></Field>
          <p className="text-xs text-slate-500">{t("enr.leaveHint")}</p>
          <SubmitButton variant="danger">{t("enr.leave")}</SubmitButton>
        </ModalForm>
      </Modal>
    </div>
  );
}

/** "Add to group" form: either the student or the group is fixed. */
export function EnrollForm({ ctx, studentId, groupId, students, groups }: { ctx: Ctx; studentId?: string; groupId?: string; students?: { id: string; label: string }[]; groups?: { id: string; name: string; code: number }[] }) {
  const { t } = ctx;
  return (
    <ModalForm action={enrollAction} className="space-y-3">
      {studentId && <input type="hidden" name="studentId" value={studentId} />}
      {groupId && <input type="hidden" name="groupId" value={groupId} />}
      {students && (
        <Field label={t("groups.pickStudent")}>
          <Input name="studentLabel" list="enroll-students" placeholder={t("groups.searchStudent")} required autoComplete="off" />
          <datalist id="enroll-students">{students.map((s) => <option key={s.id} value={s.label} />)}</datalist>
          <StudentIdBridge students={students} />
        </Field>
      )}
      {groups && (
        <Field label={t("common.group")}>
          <Select name="groupId" required>
            {groups.map((g) => <option key={g.id} value={g.id}>{g.name} (#{g.code})</option>)}
          </Select>
        </Field>
      )}
      <Field label={t("groups.startDate")}><Input type="date" name="startDate" defaultValue={todayISO()} required /></Field>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" name="trial" defaultChecked className="h-4 w-4 rounded border-slate-300" /> {t("groups.trial")}</label>
      <SubmitButton>{t("common.add")}</SubmitButton>
    </ModalForm>
  );
}

