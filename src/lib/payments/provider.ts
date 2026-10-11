// Common shape for online payment providers. Payme is implemented (payme.ts); Click and Uzum
// slot in here later (v2) with the same two operations.
export interface PayLinkInput {
  familyId: string;
  /** UZS (integer). */
  amount: number;
  returnUrl?: string;
  lang?: "uz" | "ru";
}

export interface PaymentProvider {
  code: "PAYME" | "CLICK" | "UZUM";
  /** URL the parent opens to pay; null when the center has not connected this provider. */
  buildPayLink(centerId: string, input: PayLinkInput): Promise<string | null>;
  /** Handle the provider's server-to-server callback; returns the HTTP JSON body. */
  handleCallback(req: { headers: Headers; body: string }): Promise<unknown>;
}

/** Not implemented yet — kept so Click/Uzum have a place to land. */
export const notImplemented = (code: "CLICK" | "UZUM"): PaymentProvider => ({
  code,
  buildPayLink: async () => null,
  handleCallback: async () => ({ error: `${code} is not enabled` }),
});
