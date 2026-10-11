import { requireStaff } from "@/lib/ctx";
import { PageHeader } from "@/components/ui";
import { GroupForm } from "../group-form";

export default async function NewGroupPage() {
  const ctx = await requireStaff("groups.edit");
  return (
    <>
      <PageHeader title={ctx.t("groups.new")} back={{ href: "/groups", label: ctx.t("nav.groups") }} />
      <GroupForm ctx={ctx} />
    </>
  );
}
