import { Plus } from "lucide-react";
import { requireStaff, staffInScope, type Ctx } from "@/lib/ctx";
import { db } from "@/lib/db";
import { formatPhone } from "@/lib/phone";
import { DEFAULT_PERMS, effectivePerms, PERMS, type RoleName } from "@/lib/perms";
import { Badge, Card, LinkButton, Table, Td, Th, Tr } from "@/components/ui";
import { Checkbox, Field, FormGrid, Input, Select } from "@/components/fields";
import { ActionForm, Modal, ModalForm, SubmitButton } from "@/components/client";
import { saveStaffAction, toggleStaffArchiveAction } from "../actions";

type Staff = Awaited<ReturnType<typeof load>>[number];
const load = (centerId: string) =>
  db.user.findMany({ where: { centerId }, include: { branches: { include: { branch: true } } }, orderBy: [{ archivedAt: "asc" }, { role: "asc" }, { name: "asc" }] });

function StaffForm({ ctx, branches, user }: { ctx: Ctx; branches: { id: string; name: string }[]; user?: Staff }) {
  const { t } = ctx;
  const roles: RoleName[] = ctx.role === "OWNER" ? ["OWNER", "MANAGER", "ADMIN", "TEACHER"] : ["ADMIN", "TEACHER"];
  const current = user ? effectivePerms(user.role as RoleName, user.perms) : new Set(DEFAULT_PERMS.ADMIN);
  const mine = new Set(user?.branches.map((b) => b.branchId) ?? []);
  return (
    <ModalForm action={saveStaffAction} className="space-y-4">
      {user && <input type="hidden" name="id" value={user.id} />}
      <input type="hidden" name="permsTouched" value="1" />
      <FormGrid>
        <Field label={t("common.fullName")}><Input name="name" defaultValue={user?.name} required /></Field>
        <Field label={t("common.phone")}><Input name="phone" defaultValue={user ? formatPhone(user.phone) : ""} required /></Field>
        <Field label={t("settings.role")}>
          <Select name="role" defaultValue={user?.role ?? "ADMIN"}>
            {roles.map((r) => <option key={r} value={r}>{t(`role.${r}`)}</option>)}
          </Select>
        </Field>
        <Field label={user ? t("settings.newPassword") : t("settings.password")}><Input name="password" type="password" autoComplete="new-password" minLength={6} required={!user} /></Field>
      </FormGrid>
      <Checkbox name="isTeacher" label={t("settings.isTeacher")} defaultChecked={user?.isTeacher} />
      <div>
        <div className="mb-1 text-xs font-medium text-zinc-600">{t("settings.perms")}</div>
        <p className="mb-2 text-xs text-zinc-500">{t("settings.permsHint")}</p>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {PERMS.filter((p) => ctx.role === "OWNER" || ctx.can(p)).map((p) => (
            <Checkbox key={p} name="perms" value={p} label={t(`perm.${p}`)} defaultChecked={current.has(p)} />
          ))}
        </div>
      </div>
      <div>
        <div className="mb-1 text-xs font-medium text-zinc-600">{t("settings.staffBranches")}</div>
        <div className="grid gap-1.5 sm:grid-cols-2">
          {branches.map((b) => <Checkbox key={b.id} name="branchIds" value={b.id} label={b.name} defaultChecked={mine.has(b.id)} />)}
        </div>
      </div>
      <SubmitButton>{t("common.save")}</SubmitButton>
    </ModalForm>
  );
}

export default async function StaffPage() {
  const ctx = await requireStaff("staff.manage");
  const { t } = ctx;
  const [users, branches] = await Promise.all([
    load(ctx.centerId),
    db.branch.findMany({ where: { centerId: ctx.centerId, archivedAt: null, ...(ctx.branchIds ? { id: { in: ctx.branchIds } } : {}) }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const visible = ctx.branchIds ? users.filter((u) => u.branches.some((b) => ctx.branchIds!.includes(b.branchId))) : users;
  return (
    <Card
      pad={false}
      actions={
        <>
          {ctx.can("export") && <LinkButton variant="secondary" size="sm" href="/api/export/staff">{t("common.export")}</LinkButton>}
          <Modal label={t("settings.newStaff")} icon={<Plus className="h-4 w-4" aria-hidden />} title={t("settings.newStaff")} wide>
            <StaffForm ctx={ctx} branches={branches} />
          </Modal>
        </>
      }
      title={t("settings.staff")}
    >
      <Table>
        <thead>
          <tr><Th>{t("common.fullName")}</Th><Th>{t("common.phone")}</Th><Th>{t("settings.role")}</Th><Th>{t("settings.staffBranches")}</Th><Th>{t("settings.telegram")}</Th><Th /></tr>
        </thead>
        <tbody>
          {visible.map((u) => (
            <Tr key={u.id} className={u.archivedAt ? "opacity-50" : ""}>
              <Td className="font-medium text-zinc-900">{u.name}{u.archivedAt && <> <Badge>{t("settings.archived")}</Badge></>}</Td>
              <Td className="whitespace-nowrap">{formatPhone(u.phone)}</Td>
              <Td>
                <Badge tone={u.role === "OWNER" ? "violet" : u.role === "MANAGER" ? "blue" : "gray"}>{t(`role.${u.role}`)}</Badge>
                {u.isTeacher && u.role !== "TEACHER" && <> <Badge tone="green">{t("role.TEACHER")}</Badge></>}
              </Td>
              <Td className="text-xs">{u.role === "OWNER" ? t("common.allBranches") : u.branches.map((b) => b.branch.name).join(", ") || "—"}</Td>
              <Td>{u.telegramChatId ? <Badge tone="green">{t("settings.linked")}</Badge> : <span className="text-xs text-zinc-500">{t("settings.notLinked")}</span>}</Td>
              <Td className="whitespace-nowrap text-right">
                {(ctx.role === "OWNER" || (u.role !== "OWNER" && u.role !== "MANAGER" && staffInScope(ctx, u.branches.map((b) => b.branchId)))) && (
                  <div className="flex justify-end gap-1">
                    <Modal label={t("common.edit")} title={u.name} variant="secondary" size="sm" wide>
                      <StaffForm ctx={ctx} branches={branches} user={u} />
                    </Modal>
                    {u.id !== ctx.userId && (
                      <ActionForm action={toggleStaffArchiveAction}>
                        <input type="hidden" name="id" value={u.id} />
                        <SubmitButton variant="ghost" size="sm" confirm={t("common.confirm")}>{u.archivedAt ? t("common.restore") : t("common.archive")}</SubmitButton>
                      </ActionForm>
                    )}
                  </div>
                )}
              </Td>
            </Tr>
          ))}
        </tbody>
      </Table>
    </Card>
  );
}
