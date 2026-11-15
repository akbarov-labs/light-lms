// Who made a change, as people read it: the staff member's name, the AI agent, the public form, or the system.
import type { ActorKind } from "@/generated/prisma/client";
import type { TFn } from "@/lib/i18n";

export function actorName(t: TFn, actor: ActorKind, userName?: string | null): string {
  if (userName) return userName;
  if (actor === "AGENT") return t("agent.actor");
  if (actor === "PUBLIC") return t("leads.formSource");
  return t("audit.system");
}
