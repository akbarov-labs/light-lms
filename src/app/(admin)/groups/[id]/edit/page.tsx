import { notFound } from "next/navigation";
import { canAccessBranch, requireStaff } from "@/lib/ctx";
import { db } from "@/lib/db";
import { PageHeader } from "@/components/ui";
import { GroupForm } from "../../group-form";

export default async function EditGroupPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const ctx = await requireStaff("groups.edit");
  const group = await db.group.findFirst({ where: { id, centerId: ctx.centerId }, include: { slots: true } });
  if (!group || !canAccessBranch(ctx, group.branchId)) notFound();
  return (
    <>
      <PageHeader title={`${ctx.t("groups.edit")}: ${group.name}`} back={{ href: `/groups/${id}`, label: group.name }} />
      <GroupForm ctx={ctx} group={group} />
    </>
  );
}
