import { requireStaff } from "@/lib/ctx";
import { db } from "@/lib/db";
import { Badge, Card, EmptyState } from "@/components/ui";
import { Field, FormGrid, Input } from "@/components/fields";
import { ActionForm, Modal, ModalForm, SubmitButton } from "@/components/client";
import { saveBranchAction, saveRoomAction, toggleBranchArchiveAction, toggleRoomArchiveAction } from "../actions";

export default async function BranchesPage() {
  const ctx = await requireStaff("settings");
  const { t } = ctx;
  const branches = await db.branch.findMany({
    where: { centerId: ctx.centerId },
    include: { rooms: { orderBy: { name: "asc" } } },
    orderBy: [{ archivedAt: "asc" }, { name: "asc" }],
  });
  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Modal label={`+ ${t("settings.newBranch")}`} title={t("settings.newBranch")}>
          
            <ModalForm action={saveBranchAction} className="space-y-3">
              <Field label={t("common.name")}><Input name="name" required /></Field>
              <Field label={t("common.address")}><Input name="address" /></Field>
              <Field label={t("common.phone")}><Input name="phone" /></Field>
              <SubmitButton>{t("common.create")}</SubmitButton>
            </ModalForm>
        </Modal>
      </div>
      {branches.length === 0 && <Card><EmptyState>{t("common.empty")}</EmptyState></Card>}
      {branches.map((b) => (
        <Card
          key={b.id}
          title={<span className="flex items-center gap-2">{b.name}{b.archivedAt && <Badge>{t("settings.archived")}</Badge>}</span>}
          actions={
            <>
              <Modal label={t("common.edit")} title={b.name} variant="secondary" size="sm">
                
                  <ModalForm action={saveBranchAction} className="space-y-3">
                    <input type="hidden" name="id" value={b.id} />
                    <Field label={t("common.name")}><Input name="name" defaultValue={b.name} required /></Field>
                    <Field label={t("common.address")}><Input name="address" defaultValue={b.address ?? ""} /></Field>
                    <Field label={t("common.phone")}><Input name="phone" defaultValue={b.phone ?? ""} /></Field>
                    <SubmitButton>{t("common.save")}</SubmitButton>
                  </ModalForm>
              </Modal>
              <ActionForm action={toggleBranchArchiveAction}>
                <input type="hidden" name="id" value={b.id} />
                <SubmitButton variant="ghost" size="sm" confirm={t("common.confirm")}>{b.archivedAt ? t("common.restore") : t("common.archive")}</SubmitButton>
              </ActionForm>
            </>
          }
        >
          <div className="mb-3 text-sm text-slate-500">{[b.address, b.phone].filter(Boolean).join(" · ") || "—"}</div>
          <div className="mb-2 text-xs font-semibold uppercase text-slate-500">{t("settings.rooms")}</div>
          <div className="flex flex-wrap gap-2">
            {b.rooms.map((r) => (
              <div key={r.id} className="flex items-center gap-2 rounded-lg border border-slate-200 px-2 py-1 text-sm">
                <span className={r.archivedAt ? "text-slate-400 line-through" : ""}>{r.name}</span>
                {r.capacity && <span className="text-xs text-slate-400">({r.capacity})</span>}
                <ActionForm action={toggleRoomArchiveAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <SubmitButton variant="ghost" size="sm">{r.archivedAt ? "↺" : "✕"}</SubmitButton>
                </ActionForm>
              </div>
            ))}
          </div>
          {!b.archivedAt && (
            <ActionForm action={saveRoomAction} reset className="mt-3">
              <input type="hidden" name="branchId" value={b.id} />
              <FormGrid cols={4}>
                <Input name="name" placeholder={t("settings.newRoom")} required />
                <Input name="capacity" type="number" min={1} placeholder={t("common.capacity")} />
                <SubmitButton variant="secondary">{t("common.add")}</SubmitButton>
              </FormGrid>
            </ActionForm>
          )}
        </Card>
      ))}
    </div>
  );
}
