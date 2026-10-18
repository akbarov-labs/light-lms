// Uzum Bank Merchant API (webhooks: check, create, confirm, reverse, status). Uzum POSTs JSON with
// Basic auth; the center is found by serviceId and its own login/password. Amounts are tiyin.
// Field names and error codes follow the published community implementations (pkg.go.dev
// tergeoo/payment-providers-go/uzum, shaxzodbek-uzb/pay-uz) — check them with Uzum's account manager
// before going live (DECISIONS.md 2026-10-18). Pure: storage goes through UzumRepo.
import { timingSafeEqual } from "node:crypto";

export const UZUM_MAX_TIYIN = 100_000_000 * 100;

export type UzumOp = "check" | "create" | "confirm" | "reverse" | "status";
export const UZUM_OPS: readonly UzumOp[] = ["check", "create", "confirm", "reverse", "status"];

export interface UzumTx {
  id: string;
  centerId: string;
  transId: string;
  familyId: string;
  amountTiyin: number;
  state: "CREATED" | "CONFIRMED" | "REVERSED" | "FAILED";
  createTime: number;
  confirmTime: number | null;
  reverseTime: number | null;
}

export interface UzumCenter {
  id: string;
  login: string;
  password: string;
}

export interface UzumRepo {
  centerByService(serviceId: string): Promise<UzumCenter | null>;
  family(familyId: string): Promise<{ id: string; centerId: string } | null>;
  findTx(transId: string): Promise<UzumTx | null>;
  /** Insert; when another create with the same transId won the race, return that row. */
  createTx(tx: Omit<UzumTx, "id" | "state" | "confirmTime" | "reverseTime">): Promise<UzumTx>;
  /** Post the PAYMENT and mark CONFIRMED atomically (no-op unless the row is still CREATED). */
  confirm(tx: UzumTx, now: number, paymentSource: string | null): Promise<UzumTx>;
  /** Mark REVERSED; a CONFIRMED row also gets a REVERSAL ledger entry. Atomic, idempotent. */
  reverse(tx: UzumTx, now: number): Promise<UzumTx>;
}

export const UZUM_E = {
  ACCESS_DENIED: 10001,
  JSON: 10002,
  OPERATION: 10003,
  MISSING: 10005,
  SERVICE: 10006,
  ACCOUNT: 10007,
  ALREADY: 10008,
  CANCELLED: 10009,
  TRANS_EXISTS: 10010,
  AMOUNT: 10011,
  NOT_FOUND: 10014,
  TRANS_CANCELLED: 10015,
  CANT_REVERSE: 10017,
  SYSTEM: 99999,
} as const;

export interface UzumReply {
  status: number;
  body: Record<string, unknown>;
}

class Fail extends Error {
  constructor(
    public code: number,
    public http = 400,
  ) {
    super(String(code));
  }
}

function safeEq(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

function basicAuth(header: string | null | undefined): { login: string; password: string } | null {
  const m = /^\s*Basic\s+(\S+)\s*$/i.exec(header ?? "");
  if (!m) return null;
  const decoded = Buffer.from(m[1], "base64").toString("utf8");
  const i = decoded.indexOf(":");
  return i < 0 ? null : { login: decoded.slice(0, i), password: decoded.slice(i + 1) };
}

/** params.account (plain or { value }) — the family id the parent pays into. */
function accountOf(params: unknown): string | null {
  const p = (params ?? {}) as Record<string, unknown>;
  const raw = p.account ?? p.family_id;
  const v = typeof raw === "object" && raw !== null ? (raw as { value?: unknown }).value : raw;
  return typeof v === "string" && v.length > 0 ? v : typeof v === "number" ? String(v) : null;
}

const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : typeof v === "number" ? String(v) : null);

function txView(tx: UzumTx) {
  return { transId: tx.transId, amount: tx.amountTiyin, data: { account: { value: tx.familyId } } };
}

/** Handle one Uzum webhook. Never throws. */
export async function handleUzum(op: string, req: { auth: string | null; body: string }, repo: UzumRepo, now: number = Date.now()): Promise<UzumReply> {
  let serviceId: string | number | null = null;
  const ok = (body: Record<string, unknown>): UzumReply => ({ status: 200, body: { serviceId, timestamp: now, ...body } });
  try {
    let msg: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(req.body);
      if (typeof parsed !== "object" || parsed === null) throw new Error();
      msg = parsed as Record<string, unknown>;
    } catch {
      throw new Fail(UZUM_E.JSON);
    }
    serviceId = typeof msg.serviceId === "number" || typeof msg.serviceId === "string" ? msg.serviceId : null;
    const sid = str(msg.serviceId);
    if (!sid) throw new Fail(UZUM_E.MISSING);
    const center = await repo.centerByService(sid);
    const creds = basicAuth(req.auth);
    if (!center) throw new Fail(UZUM_E.SERVICE);
    if (!creds || !safeEq(creds.login, center.login) || !safeEq(creds.password, center.password)) throw new Fail(UZUM_E.ACCESS_DENIED, 401);
    if (!(UZUM_OPS as readonly string[]).includes(op)) throw new Fail(UZUM_E.OPERATION);

    const familyFor = async (params: unknown) => {
      const id = accountOf(params);
      if (!id) throw new Fail(UZUM_E.MISSING);
      const f = await repo.family(id);
      if (!f || f.centerId !== center.id) throw new Fail(UZUM_E.ACCOUNT);
      return f;
    };
    const txOf = async () => {
      const transId = str(msg.transId);
      if (!transId) throw new Fail(UZUM_E.MISSING);
      const tx = await repo.findTx(transId);
      if (!tx || tx.centerId !== center.id) throw new Fail(UZUM_E.NOT_FOUND);
      return tx;
    };

    switch (op as UzumOp) {
      case "check": {
        const f = await familyFor(msg.params);
        return ok({ status: "OK", data: { account: { value: f.id } } });
      }
      case "create": {
        const transId = str(msg.transId);
        if (!transId) throw new Fail(UZUM_E.MISSING);
        const f = await familyFor(msg.params);
        const amount = msg.amount;
        if (typeof amount !== "number" || !Number.isInteger(amount) || amount <= 0 || amount % 100 !== 0 || amount > UZUM_MAX_TIYIN) throw new Fail(UZUM_E.AMOUNT);
        const existing = (await repo.findTx(transId)) ?? (await repo.createTx({ centerId: center.id, transId, familyId: f.id, amountTiyin: amount, createTime: now }));
        // a repeated create is answered like the first one; the same id for another payment is refused
        if (existing.centerId !== center.id || existing.familyId !== f.id || existing.amountTiyin !== amount) throw new Fail(UZUM_E.TRANS_EXISTS);
        if (existing.state === "REVERSED" || existing.state === "FAILED") throw new Fail(UZUM_E.TRANS_CANCELLED);
        return ok({ ...txView(existing), status: existing.state, transTime: existing.createTime });
      }
      case "confirm": {
        const tx = await txOf();
        if (tx.state === "REVERSED" || tx.state === "FAILED") throw new Fail(UZUM_E.TRANS_CANCELLED);
        const done = tx.state === "CONFIRMED" ? tx : await repo.confirm(tx, now, str(msg.paymentSource));
        if (done.state !== "CONFIRMED") throw new Fail(UZUM_E.TRANS_CANCELLED);
        return ok({ ...txView(done), status: "CONFIRMED", confirmTime: done.confirmTime });
      }
      case "reverse": {
        const tx = await txOf();
        const done = tx.state === "REVERSED" ? tx : await repo.reverse(tx, now);
        if (done.state !== "REVERSED") throw new Fail(UZUM_E.CANT_REVERSE);
        return ok({ ...txView(done), status: "REVERSED", reverseTime: done.reverseTime });
      }
      case "status": {
        const tx = await txOf();
        return ok({ ...txView(tx), status: tx.state, transTime: tx.createTime, confirmTime: tx.confirmTime, reverseTime: tx.reverseTime });
      }
    }
  } catch (e) {
    const code = e instanceof Fail ? e.code : UZUM_E.SYSTEM;
    if (!(e instanceof Fail)) console.error("[uzum]", e);
    return { status: e instanceof Fail ? e.http : 500, body: { serviceId, timestamp: now, status: "FAILED", errorCode: String(code) } };
  }
}

/**
 * Uzum Bank app deep link for the service with the amount (tiyin) and the account prefilled.
 * Format from Uzum partner integrations; unverified against Uzum's own docs (DECISIONS.md).
 */
export function buildUzumLink(p: { serviceId: string; familyId: string; amount: number }): string {
  const q = new URLSearchParams({ serviceId: p.serviceId, amount: String(Math.round(p.amount) * 100), account: p.familyId });
  return `https://www.uzumbank.uz/open-service?${q.toString()}`;
}
