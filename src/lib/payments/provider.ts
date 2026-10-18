// Which online payment providers a center has connected. A provider counts only when every
// credential it needs is set; the pay page and every pay link follow this one rule.
export type ProviderCode = "PAYME" | "CLICK" | "UZUM";

export interface ProviderKeys {
  paymeMerchantId: string | null;
  paymeKey: string | null;
  clickServiceId: string | null;
  clickMerchantId: string | null;
  clickSecretKey: string | null;
  uzumServiceId: string | null;
  uzumLogin: string | null;
  uzumPassword: string | null;
}

/** Prisma `select` for ProviderKeys. */
export const PROVIDER_SELECT = {
  paymeMerchantId: true,
  paymeKey: true,
  clickServiceId: true,
  clickMerchantId: true,
  clickSecretKey: true,
  uzumServiceId: true,
  uzumLogin: true,
  uzumPassword: true,
} as const;

export function enabledProviders(c: ProviderKeys): ProviderCode[] {
  const out: ProviderCode[] = [];
  if (c.paymeMerchantId && c.paymeKey) out.push("PAYME");
  if (c.clickServiceId && c.clickMerchantId && c.clickSecretKey) out.push("CLICK");
  if (c.uzumServiceId && c.uzumLogin && c.uzumPassword) out.push("UZUM");
  return out;
}
