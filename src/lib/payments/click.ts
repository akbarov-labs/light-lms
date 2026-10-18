// Click SHOP-API (Prepare / Complete), checked against Click's own integration
// (github.com/click-llc/click-integration-php, BasicPaymentsErrors::request_check).
// Pure: storage goes through ClickRepo. Amounts are whole so'm (Click sends "1000" or "1000.00").
import { createHash, timingSafeEqual } from "node:crypto";

export const CLICK_MAX_AMOUNT = 100_000_000; // so'm; far above any tuition payment

export interface ClickTx {
  id: string;
  centerId: string;
  clickTransId: string;
  familyId: string;
  amount: number;
  prepareId: number;
  /** 0 prepared, 1 confirmed, -1 cancelled */
  state: 0 | 1 | -1;
}

export interface ClickCenter {
  id: string;
  secretKey: string;
}

export interface ClickRepo {
  /** Center whose Click service_id this is (unique per center), with its secret key. */
  centerByService(serviceId: string): Promise<ClickCenter | null>;
  family(familyId: string): Promise<{ id: string; centerId: string } | null>;
  byClickId(clickTransId: string): Promise<ClickTx | null>;
  byPrepareId(prepareId: number): Promise<ClickTx | null>;
  /** Insert a prepared transaction; a concurrent Prepare with the same click_trans_id returns the winner. */
  prepare(tx: { centerId: string; clickTransId: string; clickPaydocId: string | null; familyId: string; amount: number }): Promise<ClickTx>;
  /** Post the PAYMENT and mark the transaction confirmed — atomically; returns the row as it ends up. */
  confirm(tx: ClickTx): Promise<ClickTx>;
  /** Mark a prepared transaction cancelled (Click reported a failed payment). */
  cancel(tx: ClickTx, clickError: number): Promise<ClickTx>;
}

export const CLICK_E = {
  OK: 0,
  SIGN: -1,
  AMOUNT: -2,
  ACTION: -3,
  ALREADY_PAID: -4,
  USER: -5,
  NO_TX: -6,
  UPDATE: -7,
  REQUEST: -8,
  CANCELLED: -9,
} as const;

const NOTE: Record<number, string> = {
  [CLICK_E.OK]: "Success",
  [CLICK_E.SIGN]: "SIGN CHECK FAILED!",
  [CLICK_E.AMOUNT]: "Incorrect parameter amount",
  [CLICK_E.ACTION]: "Action not found",
  [CLICK_E.ALREADY_PAID]: "Already paid",
  [CLICK_E.USER]: "User does not exist",
  [CLICK_E.NO_TX]: "Transaction does not exist",
  [CLICK_E.UPDATE]: "Failed to update user",
  [CLICK_E.REQUEST]: "Error in request from click",
  [CLICK_E.CANCELLED]: "Transaction cancelled",
};

export type ClickParams = Record<string, string | undefined>;

export interface ClickResponse {
  click_trans_id: number | string | null;
  merchant_trans_id: string | null;
  merchant_prepare_id?: number | null;
  merchant_confirm_id?: number | null;
  error: number;
  error_note: string;
}

const REQUIRED = ["click_trans_id", "service_id", "merchant_trans_id", "amount", "action", "error", "sign_time", "sign_string", "click_paydoc_id"] as const;

/** md5(click_trans_id + service_id + SECRET_KEY + merchant_trans_id + [merchant_prepare_id] + amount + action + sign_time). */
export function clickSign(p: ClickParams, secretKey: string): string {
  const prepare = p.action === "1" ? (p.merchant_prepare_id ?? "") : "";
  return createHash("md5")
    .update(`${p.click_trans_id}${p.service_id}${secretKey}${p.merchant_trans_id}${prepare}${p.amount}${p.action}${p.sign_time}`)
    .digest("hex");
}

function sameHex(a: string, b: string): boolean {
  const x = Buffer.from(a.toLowerCase());
  const y = Buffer.from(b.toLowerCase());
  return x.length === y.length && timingSafeEqual(x, y);
}

/** "1000", "1000.0", "1000.00" → 1000; anything with tiyin, non-positive or absurd → null. */
export function clickAmount(raw: string | undefined): number | null {
  if (!raw || !/^\d+(\.\d{1,2})?$/.test(raw.trim())) return null;
  const v = Number(raw);
  if (!Number.isFinite(v) || !Number.isInteger(v) || v <= 0 || v > CLICK_MAX_AMOUNT) return null;
  return v;
}

/**
 * Handle one Prepare (action=0) or Complete (action=1) call. `expect` pins the action an endpoint
 * accepts (/api/click/prepare vs /complete); a single URL configured for both passes nothing.
 * Never throws.
 */
export async function handleClick(p: ClickParams, repo: ClickRepo, expect?: 0 | 1): Promise<ClickResponse> {
  const base = (code: number, extra: Partial<ClickResponse> = {}): ClickResponse => ({
    click_trans_id: p.click_trans_id ? (/^\d+$/.test(p.click_trans_id) ? Number(p.click_trans_id) : p.click_trans_id) : null,
    merchant_trans_id: p.merchant_trans_id ?? null,
    ...extra,
    error: code,
    error_note: NOTE[code],
  });
  try {
    if (REQUIRED.some((k) => p[k] === undefined || p[k] === "") || (p.action === "1" && !p.merchant_prepare_id)) return base(CLICK_E.REQUEST);
    const center = await repo.centerByService(p.service_id!);
    if (!center || !sameHex(clickSign(p, center.secretKey), p.sign_string!)) return base(CLICK_E.SIGN);
    if ((p.action !== "0" && p.action !== "1") || (expect !== undefined && p.action !== String(expect))) return base(CLICK_E.ACTION);

    const family = await repo.family(p.merchant_trans_id!);
    if (!family || family.centerId !== center.id) return base(CLICK_E.USER);
    const amount = clickAmount(p.amount);

    if (p.action === "0") {
      const existing = await repo.byClickId(p.click_trans_id!);
      const reply = (tx: ClickTx) => {
        const ids = { merchant_prepare_id: tx.prepareId };
        if (tx.state === 1) return base(CLICK_E.ALREADY_PAID, ids);
        if (tx.state === -1) return base(CLICK_E.CANCELLED, ids);
        if (tx.amount !== amount || tx.familyId !== family.id) return base(CLICK_E.AMOUNT, ids);
        return base(CLICK_E.OK, ids);
      };
      if (existing) return existing.centerId === center.id ? reply(existing) : base(CLICK_E.NO_TX);
      if (amount === null) return base(CLICK_E.AMOUNT);
      const tx = await repo.prepare({ centerId: center.id, clickTransId: p.click_trans_id!, clickPaydocId: p.click_paydoc_id ?? null, familyId: family.id, amount });
      return reply(tx);
    }

    // Complete
    const prepareId = Number(p.merchant_prepare_id);
    const tx = Number.isInteger(prepareId) ? await repo.byPrepareId(prepareId) : null;
    if (!tx || tx.centerId !== center.id || tx.clickTransId !== p.click_trans_id || tx.familyId !== family.id) return base(CLICK_E.NO_TX);
    const ids = { merchant_confirm_id: tx.prepareId };
    if (tx.state === 1) return base(CLICK_E.ALREADY_PAID, ids);
    if (tx.state === -1) return base(CLICK_E.CANCELLED, ids);
    if (amount === null || amount !== tx.amount) return base(CLICK_E.AMOUNT, ids);
    // Click reports a failed payment (negative error): cancel it and answer -9
    const clickError = Number(p.error);
    if (Number.isFinite(clickError) && clickError < 0) {
      await repo.cancel(tx, clickError);
      return base(CLICK_E.CANCELLED, ids);
    }
    const done = await repo.confirm(tx);
    if (done.state === 1) return base(CLICK_E.OK, ids);
    return base(done.state === -1 ? CLICK_E.CANCELLED : CLICK_E.UPDATE, ids);
  } catch (e) {
    console.error("[click]", e);
    return base(CLICK_E.UPDATE);
  }
}

/** my.click.uz checkout link; the family id travels as transaction_param (= merchant_trans_id). */
export function buildClickLink(p: { serviceId: string; merchantId: string; familyId: string; amount: number; returnUrl?: string }): string {
  const q = new URLSearchParams({ service_id: p.serviceId, merchant_id: p.merchantId, amount: String(Math.round(p.amount)), transaction_param: p.familyId });
  if (p.returnUrl) q.set("return_url", p.returnUrl);
  return `https://my.click.uz/services/pay?${q.toString()}`;
}
