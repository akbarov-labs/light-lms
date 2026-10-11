import { requireStaff } from "@/lib/ctx";
import { PageHeader } from "@/components/ui";

export default async function Dashboard() {
  const ctx = await requireStaff();
  return <PageHeader title={ctx.t("nav.dashboard")} />;
}
