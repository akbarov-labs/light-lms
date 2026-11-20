import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/ctx";
import { PageHeader } from "@/components/ui";
import { Tabs } from "@/components/tabs";
import { managedBotsOn } from "@/lib/managed-bots/service";

export default async function SettingsLayout({ children }: { children: ReactNode }) {
  const ctx = await requireStaff();
  if (!ctx.can("settings") && !ctx.can("staff.manage")) redirect("/forbidden");
  const { t } = ctx;
  const items = [
    ...(ctx.can("settings")
      ? [
          { href: "/settings", label: t("settings.center"), exact: true },
          { href: "/settings/branches", label: t("settings.branches") },
          { href: "/settings/holidays", label: t("settings.holidays") },
          { href: "/settings/plan", label: t("plan.title") },
          ...(managedBotsOn() ? [{ href: "/settings/telegram", label: t("settings.telegramBot") }] : []),
        ]
      : []),
    ...(ctx.can("staff.manage") ? [{ href: "/settings/staff", label: t("settings.staff") }] : []),
  ];
  return (
    <>
      <PageHeader title={t("nav.settings")} />
      <Tabs items={items} />
      {children}
    </>
  );
}
