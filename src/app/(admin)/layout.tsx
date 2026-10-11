import type { ReactNode } from "react";
import { requireCtx } from "@/lib/ctx";
import { AdminShell } from "@/components/shell";

export const dynamic = "force-dynamic";

export default async function AdminLayout({ children }: { children: ReactNode }) {
  const ctx = await requireCtx();
  return <AdminShell ctx={ctx}>{children}</AdminShell>;
}
