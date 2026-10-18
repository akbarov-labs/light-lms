import { db } from "@/lib/db";
import { appUrl } from "@/lib/env";
import { enabledProviders, PROVIDER_SELECT } from "./provider";

/** Public pay page for a family, or null when the center has no online payment connected. */
export async function payLinkForFamily(familyId: string): Promise<string | null> {
  const f = await db.family.findUnique({ where: { id: familyId }, select: { center: { select: PROVIDER_SELECT } } });
  if (!f || enabledProviders(f.center).length === 0) return null;
  return `${appUrl()}/pay/${familyId}`;
}
