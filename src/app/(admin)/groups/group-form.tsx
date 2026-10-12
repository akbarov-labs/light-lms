import type { Group, GroupSlot } from "@prisma/client";
import type { Ctx } from "@/lib/ctx";
import { db } from "@/lib/db";
import { toISODate, todayISO } from "@/lib/dates";
import { Card } from "@/components/ui";
import { Field, FormGrid, Input, Select } from "@/components/fields";
import { ActionForm, SubmitButton } from "@/components/client";
import { SlotsEditor } from "./slots-editor";
import { createGroupAction, updateGroupAction } from "./actions";

export async function GroupForm({ ctx, group }: { ctx: Ctx; group?: Group & { slots: GroupSlot[] } }) {
  const { t } = ctx;
  const branchFilter = ctx.branchIds ? { id: { in: ctx.branchIds } } : {};
  const [courses, branches, teachers, rooms] = await Promise.all([
    db.course.findMany({ where: { centerId: ctx.centerId, OR: [{ archivedAt: null }, ...(group ? [{ id: group.courseId }] : [])] }, orderBy: { name: "asc" } }),
    db.branch.findMany({ where: { centerId: ctx.centerId, archivedAt: null, ...branchFilter }, orderBy: { name: "asc" } }),
    db.user.findMany({ where: { centerId: ctx.centerId, archivedAt: null, OR: [{ isTeacher: true }, { role: "TEACHER" }] }, orderBy: { name: "asc" } }),
    db.room.findMany({ where: { archivedAt: null, branch: { centerId: ctx.centerId, archivedAt: null, ...(ctx.branchIds ? { id: { in: ctx.branchIds } } : {}) } }, include: { branch: true }, orderBy: [{ branch: { name: "asc" } }, { name: "asc" }] }),
  ]);
  const days = [1, 2, 3, 4, 5, 6, 7].map((d) => t(`common.weekday.${d}` as "common.weekday.1"));
  return (
    <ActionForm action={group ? updateGroupAction : createGroupAction} className="space-y-4">
      {group && <input type="hidden" name="id" value={group.id} />}
      <Card>
        <FormGrid cols={3}>
          <Field label={t("common.name")}><Input name="name" defaultValue={group?.name} placeholder={t("groups.namePlaceholder")} required /></Field>
          <Field label={t("common.course")}>
            <Select name="courseId" defaultValue={group?.courseId} required>
              {courses.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </Select>
          </Field>
          <Field label={t("common.teacher")}>
            <Select name="teacherId" defaultValue={group?.teacherId} required>
              {teachers.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </Select>
          </Field>
          <Field label={t("common.branch")}>
            <Select name="branchId" defaultValue={group?.branchId ?? ctx.activeBranchId ?? branches[0]?.id} required>
              {branches.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </Select>
          </Field>
          <Field label={t("common.room")}>
            <Select name="roomId" defaultValue={group?.roomId ?? ""}>
              <option value="">{t("groups.noRoom")}</option>
              {rooms.map((r) => <option key={r.id} value={r.id}>{r.branch.name} · {r.name}</option>)}
            </Select>
          </Field>
          <Field label={t("common.capacity")}><Input name="capacity" type="number" min={1} defaultValue={group?.capacity ?? ""} /></Field>
          <Field label={t("common.start")}><Input name="startDate" type="date" defaultValue={group ? toISODate(group.startDate) : todayISO()} required /></Field>
          <Field label={t("common.end")} hint={t("common.optional")}><Input name="endDate" type="date" defaultValue={group?.endDate ? toISODate(group.endDate) : ""} /></Field>
          <Field label={t("groups.priceOverride")} hint={t("common.optional")}><Input name="priceOverride" inputMode="numeric" defaultValue={group?.priceOverride ?? ""} /></Field>
          {group && <Field label={t("groups.priceFrom")} hint={t("courses.priceFromHint")}><Input name="priceFrom" type="date" /></Field>}
        </FormGrid>
      </Card>
      <Card title={t("groups.schedule")}>
        <SlotsEditor initial={group?.slots.map((s) => ({ weekday: s.weekday, startTime: s.startTime, endTime: s.endTime })) ?? []} days={days} addLabel={t("groups.addSlot")} removeLabel={t("common.delete")} />
      </Card>
      <div className="flex justify-end"><SubmitButton>{group ? t("common.save") : t("common.create")}</SubmitButton></div>
    </ActionForm>
  );
}
