// Payme Merchant API (JSON-RPC 2.0) — HANDOFF §10, checked against developer.help.paycom.uz.
// Pure: storage goes through PaymeRepo, the clock is passed in. Amounts are in tiyin (UZS × 100).

export const TIMEOUT_MS = 43_200_000; // 12 hours
export const MAX_TIYIN = 100_000_000 * 100; // 100M so'm per payment is far above any tuition

export interface PaymeTx {
  id: string;
  paymeId: string;
  centerId: string;
  familyId: string;
  amountTiyin: number;
  state: 1 | 2 | -1 | -2;
  createTime: number;
  performTime: number | null;
  cancelTime: number | null;
  reason: number | null;
}

export interface PaymeRepo {
  /** Center whose Payme key matches (the key identifies the merchant cashbox). */
  centerByKey(key: string): Promise<{ id: string } | null>;
  family(familyId: string): Promise<{ id: string; centerId: string } | null>;
  findTx(paymeId: string): Promise<PaymeTx | null>;
  activeTxForFamily(familyId: string): Promise<PaymeTx | null>;
  createTx(tx: Omit<PaymeTx, "id">): Promise<PaymeTx>;
  /** Post the PAYMENT ledger entry and mark the transaction performed — atomically. */
  perform(tx: PaymeTx, now: number): Promise<PaymeTx>;
  /** Cancel; for a performed transaction also post the REVERSAL. Atomic. */
  cancel(tx: PaymeTx, reason: number, now: number): Promise<PaymeTx>;
  statement(centerId: string, from: number, to: number): Promise<PaymeTx[]>;
}

type Msg = { ru: string; uz: string; en: string };
export interface RpcError {
  code: number;
  message: Msg;
  data?: string;
}
export interface RpcResponse {
  jsonrpc: "2.0";
  id: number | string | null;
  result?: unknown;
  error?: RpcError;
}

const M = {
  auth: { ru: "Недостаточно привилегий", uz: "Ruxsat yo'q", en: "Insufficient privileges" },
  parse: { ru: "Ошибка разбора JSON", uz: "JSON xato", en: "Parse error" },
  invalid: { ru: "Неверный запрос", uz: "Noto'g'ri so'rov", en: "Invalid request" },
  method: { ru: "Метод не найден", uz: "Metod topilmadi", en: "Method not found" },
  amount: { ru: "Неверная сумма", uz: "Noto'g'ri summa", en: "Invalid amount" },
  account: { ru: "Плательщик не найден", uz: "To'lovchi topilmadi", en: "Payer not found" },
  busy: { ru: "Есть незавершённая транзакция", uz: "Tugallanmagan tranzaksiya bor", en: "Another transaction is in progress" },
  notFound: { ru: "Транзакция не найдена", uz: "Tranzaksiya topilmadi", en: "Transaction not found" },
  cantPerform: { ru: "Невозможно выполнить операцию", uz: "Amalni bajarib bo'lmaydi", en: "Unable to perform operation" },
  internal: { ru: "Системная ошибка", uz: "Tizim xatosi", en: "System error" },
} satisfies Record<string, Msg>;

export const E = {
  AUTH: -32504,
  PARSE: -32700,
  INVALID: -32600,
  METHOD: -32601,
  INTERNAL: -32400,
  AMOUNT: -31001,
  NOT_FOUND: -31003,
  CANT_CANCEL: -31007,
  CANT_PERFORM: -31008,
  ACCOUNT: -31050,
  BUSY: -31099,
} as const;

class RpcFail extends Error {
  constructor(
    public code: number,
    public msg: Msg,
    public data?: string,
  ) {
    super(String(code));
  }
}

/** Parse "Basic base64(Paycom:<key>)" → key, or null. */
export function keyFromAuth(header: string | null | undefined): string | null {
  const m = /^Basic\s+(.+)$/i.exec(header ?? "");
  if (!m) return null;
  let decoded = "";
  try {
    decoded = Buffer.from(m[1], "base64").toString("utf8");
  } catch {
    return null;
  }
  const i = decoded.indexOf(":");
  if (i < 0 || decoded.slice(0, i) !== "Paycom") return null;
  return decoded.slice(i + 1) || null;
}

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown): string | null => (typeof v === "string" && v.length > 0 ? v : null);

function view(tx: PaymeTx) {
  return {
    create_time: tx.createTime,
    perform_time: tx.performTime ?? 0,
    cancel_time: tx.cancelTime ?? 0,
    transaction: tx.id,
    state: tx.state,
    reason: tx.reason,
  };
}

async function checkAccount(repo: PaymeRepo, centerId: string, params: Record<string, unknown>) {
  const account = (params.account ?? {}) as Record<string, unknown>;
  const familyId = str(account.family_id);
  const family = familyId ? await repo.family(familyId) : null;
  if (!family || family.centerId !== centerId) throw new RpcFail(E.ACCOUNT, M.account, "family_id");
  const amount = num(params.amount);
  if (amount === null || !Number.isInteger(amount) || amount <= 0 || amount > MAX_TIYIN) throw new RpcFail(E.AMOUNT, M.amount, "amount");
  return { family, amount };
}

async function txOf(repo: PaymeRepo, centerId: string, params: Record<string, unknown>) {
  const id = str(params.id);
  if (!id) throw new RpcFail(E.INVALID, M.invalid, "id");
  const tx = await repo.findTx(id);
  if (!tx || tx.centerId !== centerId) throw new RpcFail(E.NOT_FOUND, M.notFound, "id");
  return tx;
}

async function dispatch(repo: PaymeRepo, centerId: string, method: string, params: Record<string, unknown>, now: number): Promise<unknown> {
  switch (method) {
    case "CheckPerformTransaction": {
      await checkAccount(repo, centerId, params);
      return { allow: true };
    }
    case "CreateTransaction": {
      const id = str(params.id);
      const time = num(params.time);
      if (!id || time === null) throw new RpcFail(E.INVALID, M.invalid);
      const existing = await repo.findTx(id);
      if (existing) {
        if (existing.centerId !== centerId) throw new RpcFail(E.NOT_FOUND, M.notFound, "id");
        if (existing.state !== 1) throw new RpcFail(E.CANT_PERFORM, M.cantPerform, "state");
        if (now - existing.createTime > TIMEOUT_MS) {
          await repo.cancel(existing, 4, now);
          throw new RpcFail(E.CANT_PERFORM, M.cantPerform, "timeout");
        }
        return { create_time: existing.createTime, transaction: existing.id, state: existing.state };
      }
      const { family, amount } = await checkAccount(repo, centerId, params);
      const active = await repo.activeTxForFamily(family.id);
      if (active) {
        if (now - active.createTime > TIMEOUT_MS) await repo.cancel(active, 4, now);
        else throw new RpcFail(E.BUSY, M.busy, "family_id");
      }
      const tx = await repo.createTx({ paymeId: id, centerId, familyId: family.id, amountTiyin: amount, state: 1, createTime: now, performTime: null, cancelTime: null, reason: null });
      return { create_time: tx.createTime, transaction: tx.id, state: tx.state };
    }
    case "PerformTransaction": {
      const tx = await txOf(repo, centerId, params);
      if (tx.state === 2) return { transaction: tx.id, perform_time: tx.performTime, state: 2 };
      if (tx.state !== 1) throw new RpcFail(E.CANT_PERFORM, M.cantPerform, "state");
      if (now - tx.createTime > TIMEOUT_MS) {
        await repo.cancel(tx, 4, now);
        throw new RpcFail(E.CANT_PERFORM, M.cantPerform, "timeout");
      }
      const done = await repo.perform(tx, now);
      return { transaction: done.id, perform_time: done.performTime, state: done.state };
    }
    case "CancelTransaction": {
      const tx = await txOf(repo, centerId, params);
      const reason = num(params.reason);
      if (reason === null) throw new RpcFail(E.INVALID, M.invalid, "reason");
      if (tx.state < 0) return { transaction: tx.id, cancel_time: tx.cancelTime, state: tx.state };
      const done = await repo.cancel(tx, reason, now);
      return { transaction: done.id, cancel_time: done.cancelTime, state: done.state };
    }
    case "CheckTransaction": {
      const tx = await txOf(repo, centerId, params);
      return view(tx);
    }
    case "GetStatement": {
      const from = num(params.from);
      const to = num(params.to);
      if (from === null || to === null) throw new RpcFail(E.INVALID, M.invalid);
      const list = await repo.statement(centerId, from, to);
      return {
        transactions: list.map((tx) => ({
          id: tx.paymeId,
          time: tx.createTime,
          amount: tx.amountTiyin,
          account: { family_id: tx.familyId },
          ...view(tx),
        })),
      };
    }
    default:
      throw new RpcFail(E.METHOD, M.method, method);
  }
}

/** Handle one Payme JSON-RPC request. Never throws; always returns a JSON-RPC response object. */
export async function handlePayme(req: { auth: string | null; body: string }, repo: PaymeRepo, now: number = Date.now()): Promise<RpcResponse> {
  let id: RpcResponse["id"] = null;
  try {
    let parsed: unknown;
    try {
      parsed = JSON.parse(req.body);
    } catch {
      throw new RpcFail(E.PARSE, M.parse);
    }
    const msg = (parsed ?? {}) as { id?: number | string; method?: unknown; params?: unknown };
    id = msg.id ?? null;
    const key = keyFromAuth(req.auth);
    const center = key ? await repo.centerByKey(key) : null;
    if (!center) throw new RpcFail(E.AUTH, M.auth);
    if (typeof msg.method !== "string" || typeof msg.params !== "object" || msg.params === null) throw new RpcFail(E.INVALID, M.invalid);
    const result = await dispatch(repo, center.id, msg.method, msg.params as Record<string, unknown>, now);
    return { jsonrpc: "2.0", id, result };
  } catch (e) {
    if (e instanceof RpcFail) return { jsonrpc: "2.0", id, error: { code: e.code, message: e.msg, ...(e.data ? { data: e.data } : {}) } };
    console.error("[payme]", e);
    return { jsonrpc: "2.0", id, error: { code: E.INTERNAL, message: M.internal } };
  }
}

/** Checkout link: https://checkout.paycom.uz/<base64("m=…;ac.family_id=…;a=…;c=…;l=…")>. */
export function buildPayLink(p: { merchantId: string; familyId: string; amountTiyin: number; returnUrl?: string; lang?: "uz" | "ru"; test?: boolean }): string {
  const parts = [`m=${p.merchantId}`, `ac.family_id=${p.familyId}`, `a=${Math.round(p.amountTiyin)}`];
  if (p.returnUrl) parts.push(`c=${p.returnUrl}`);
  parts.push(`l=${p.lang ?? "uz"}`);
  const base = p.test ? "https://checkout.test.paycom.uz" : "https://checkout.paycom.uz";
  return `${base}/${Buffer.from(parts.join(";"), "utf8").toString("base64")}`;
}

