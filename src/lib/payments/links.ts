import { db } from "@/lib/db";

/** Public pay page for a family, or null when the center has no Payme keys. */
export async function payLinkForFamily(familyId: string): Promise<string | null> {
  const f = await db.family.findUnique({ where: { id: familyId }, select: { center: { select: { paymeMerchantId: true, paymeKey: true } } } });
  if (!f?.center.paymeMerchantId || !f.center.paymeKey) return null;
  return `${(process.env.APP_URL ?? "http://localhost:3000").replace(/\/$/, "")}/pay/${familyId}`;
}
