import { beforeEach, describe, expect, it } from "vitest";
import { buildPayLink, DuplicatePaymeTx, E, handlePayme, keyFromAuth, TIMEOUT_MS, type PaymeFiscalItem, type PaymeRepo, type PaymeTx } from "./payme";

const KEY = "secret-key";
const auth = (key = KEY) => `Basic ${Buffer.from(`Paycom:${key}`).toString("base64")}`;
const T0 = 1_790_000_000_000;

/** In-memory repo that mirrors what the DB repo does (ledger entries included). */
class MemRepo implements PaymeRepo {
  txs: PaymeTx[] = [];
  ledger: { type: "PAYMENT" | "REVERSAL"; amount: number; txId: string }[] = [];
  families = new Map([
    ["fam1", { id: "fam1", centerId: "c1" }],
    ["famX", { id: "famX", centerId: "c2" }],
  ]);
  fiscal: PaymeFiscalItem | null = null;
  async centerByKey(key: string) {
    return key === KEY ? { id: "c1", fiscal: this.fiscal } : key === "other" ? { id: "c2" } : null;
  }
  async family(id: string) {
    return this.families.get(id) ?? null;
  }
  /** Simulates a concurrent create: the next findTx misses a row that is already there. */
  missNextFind = false;
  async findTx(paymeId: string) {
    if (this.missNextFind) {
      this.missNextFind = false;
      return null;
    }
    return this.txs.find((t) => t.paymeId === paymeId) ?? null;
  }
  async createTx(tx: Omit<PaymeTx, "id">) {
    if (this.txs.some((t) => t.paymeId === tx.paymeId)) throw new DuplicatePaymeTx(tx.paymeId);
    const t = { ...tx, id: `our-${this.txs.length + 1}` };
    this.txs.push(t);
    return t;
  }
  async perform(tx: PaymeTx, now: number) {
    this.ledger.push({ type: "PAYMENT", amount: tx.amountTiyin / 100, txId: tx.id });
    Object.assign(tx, { state: 2, performTime: now });
    return tx;
  }
  async cancel(tx: PaymeTx, reason: number, now: number) {
    if (tx.state === 2) this.ledger.push({ type: "REVERSAL", amount: -tx.amountTiyin / 100, txId: tx.id });
    Object.assign(tx, { state: tx.state === 2 ? -2 : -1, cancelTime: now, reason });
    return tx;
  }
  async statement(centerId: string, from: number, to: number) {
    const time = (t: PaymeTx) => t.paymeTime ?? t.createTime;
    return this.txs.filter((t) => t.centerId === centerId && time(t) >= from && time(t) <= to).sort((a, b) => time(a) - time(b));
  }
}

let repo: MemRepo;
const call = (method: string, params: object, opts: { now?: number; key?: string; raw?: string } = {}) =>
  handlePayme({ auth: auth(opts.key), body: opts.raw ?? JSON.stringify({ jsonrpc: "2.0", id: 7, method, params }) }, repo, opts.now ?? T0);
const create = (id: string, amount = 60_000_000, family = "fam1", now = T0) => call("CreateTransaction", { id, time: now, amount, account: { family_id: family } }, { now });

beforeEach(() => {
  repo = new MemRepo();
});

describe("Payme auth & protocol", () => {
  it("rejects a wrong key with -32504", async () => {
    const r = await call("CheckPerformTransaction", { amount: 100, account: { family_id: "fam1" } }, { key: "nope" });
    expect(r.error?.code).toBe(E.AUTH);
    expect(r.error?.message).toMatchObject({ ru: expect.any(String), uz: expect.any(String), en: expect.any(String) });
    expect((await handlePayme({ auth: null, body: "{}" }, repo)).error?.code).toBe(E.AUTH);
    expect(keyFromAuth(`Basic ${Buffer.from("Other:secret-key").toString("base64")}`)).toBeNull();
  });
  it("bad JSON → -32700, unknown method → -32601, bad shape → -32600", async () => {
    expect((await call("x", {}, { raw: "{oops" })).error?.code).toBe(E.PARSE);
    expect((await call("Explode", {})).error?.code).toBe(E.METHOD);
    expect((await handlePayme({ auth: auth(), body: JSON.stringify({ id: 1, method: "CheckTransaction" }) }, repo)).error?.code).toBe(E.INVALID);
  });
  it("echoes the request id", async () => {
    expect((await call("CheckPerformTransaction", { amount: 100, account: { family_id: "fam1" } })).id).toBe(7);
  });
});

describe("CheckPerformTransaction", () => {
  it("happy path without fiscal data: no detail", async () => {
    expect((await call("CheckPerformTransaction", { amount: 60_000_000, account: { family_id: "fam1" } })).result).toEqual({ allow: true });
  });
  it("happy path with fiscal data: a receipt line for the whole amount (tiyin)", async () => {
    repo.fiscal = { title: "O'quv kurslari uchun to'lov", ikpu: "10305008002000000", packageCode: "1545632", vatPercent: 0 };
    expect((await call("CheckPerformTransaction", { amount: 60_000_000, account: { family_id: "fam1" } })).result).toEqual({
      allow: true,
      detail: {
        receipt_type: 0,
        items: [{ title: "O'quv kurslari uchun to'lov", price: 60_000_000, count: 1, code: "10305008002000000", package_code: "1545632", vat_percent: 0 }],
      },
    });
  });
  it("unknown family (or another center's family) → -31050 with data=family_id", async () => {
    const r = await call("CheckPerformTransaction", { amount: 100, account: { family_id: "nobody" } });
    expect(r.error).toMatchObject({ code: E.ACCOUNT, data: "family_id" });
    expect((await call("CheckPerformTransaction", { amount: 100, account: { family_id: "famX" } })).error?.code).toBe(E.ACCOUNT);
  });
  it("bad amount → -31001", async () => {
    for (const amount of [0, -5, 1.5, 1e15, 60_000_050]) {
      expect((await call("CheckPerformTransaction", { amount, account: { family_id: "fam1" } })).error?.code).toBe(E.AMOUNT);
    }
  });
});

describe("CreateTransaction", () => {
  it("creates state 1 and is idempotent for the same id", async () => {
    const a = await create("p1");
    expect(a.result).toEqual({ create_time: T0, transaction: "our-1", state: 1 });
    const b = await create("p1");
    expect(b.result).toEqual(a.result);
    expect(repo.txs).toHaveLength(1);
  });
  it("parallel transactions for the same family are allowed (accumulative wallet)", async () => {
    expect((await create("p1")).result).toMatchObject({ state: 1 });
    expect((await create("p2", 30_000_000)).result).toMatchObject({ state: 1 });
    expect((await call("PerformTransaction", { id: "p2" }, { now: T0 + 1000 })).result).toMatchObject({ state: 2 });
    expect((await call("PerformTransaction", { id: "p1" }, { now: T0 + 2000 })).result).toMatchObject({ state: 2 });
    expect(repo.ledger.map((l) => l.amount)).toEqual([300_000, 600_000]);
  });
  it("each transaction still times out on its own after 12 h", async () => {
    await create("p1");
    expect((await create("p2", 60_000_000, "fam1", T0 + TIMEOUT_MS + 1)).result).toMatchObject({ state: 1 });
    expect((await call("PerformTransaction", { id: "p1" }, { now: T0 + TIMEOUT_MS + 2 })).error?.code).toBe(E.CANT_PERFORM);
    expect(repo.txs[0]).toMatchObject({ state: -1, reason: 4 });
    expect(repo.txs[1]).toMatchObject({ state: 1 });
  });
  it("another center's family is refused even with a valid key → -31050", async () => {
    expect((await create("p1", 60_000_000, "famX")).error).toMatchObject({ code: E.ACCOUNT, data: "family_id" });
    expect(repo.txs).toHaveLength(0);
  });
  it("re-create after 12h timeout → cancelled with reason 4 and -31008", async () => {
    await create("p1");
    const r = await call("CreateTransaction", { id: "p1", time: T0, amount: 60_000_000, account: { family_id: "fam1" } }, { now: T0 + TIMEOUT_MS + 1 });
    expect(r.error?.code).toBe(E.CANT_PERFORM);
    expect(repo.txs[0]).toMatchObject({ state: -1, reason: 4 });
  });
  it("account and amount errors", async () => {
    expect((await create("p1", 100, "nobody")).error?.code).toBe(E.ACCOUNT);
    expect((await create("p1", 0)).error?.code).toBe(E.AMOUNT);
  });
  it("re-create of a performed transaction → -31008", async () => {
    await create("p1");
    await call("PerformTransaction", { id: "p1" });
    expect((await create("p1")).error?.code).toBe(E.CANT_PERFORM);
  });
  it("losing the insert race to a concurrent create answers the winner, not −32400 (L8)", async () => {
    const a = await create("p1");
    repo.missNextFind = true;
    const b = await create("p1");
    expect(b.error).toBeUndefined();
    expect(b.result).toEqual(a.result);
    expect(repo.txs).toHaveLength(1);
    // the same checks as the idempotent path: a performed winner is −31008
    await call("PerformTransaction", { id: "p1" });
    repo.missNextFind = true;
    expect((await create("p1")).error?.code).toBe(E.CANT_PERFORM);
  });
});

describe("PerformTransaction", () => {
  it("losing the row to a concurrent cancel answers −31008 and posts nothing", async () => {
    await create("p1");
    const realPerform = repo.perform.bind(repo);
    repo.perform = async (tx) => {
      Object.assign(tx, { state: -1, cancelTime: T0 + 1, reason: 3 });
      return tx;
    };
    expect((await call("PerformTransaction", { id: "p1" })).error?.code).toBe(E.CANT_PERFORM);
    expect(repo.ledger).toEqual([]);
    repo.perform = realPerform;
  });

  it("posts the payment once (idempotent)", async () => {
    await create("p1");
    const a = await call("PerformTransaction", { id: "p1" }, { now: T0 + 1000 });
    expect(a.result).toEqual({ transaction: "our-1", perform_time: T0 + 1000, state: 2 });
    const b = await call("PerformTransaction", { id: "p1" }, { now: T0 + 5000 });
    expect(b.result).toEqual(a.result);
    expect(repo.ledger).toEqual([{ type: "PAYMENT", amount: 600_000, txId: "our-1" }]);
  });
  it("not found → -31003; another center's transaction is not found either", async () => {
    expect((await call("PerformTransaction", { id: "zzz" })).error?.code).toBe(E.NOT_FOUND);
    await call("CreateTransaction", { id: "x1", time: T0, amount: 100, account: { family_id: "famX" } }, { key: "other" });
    expect((await call("PerformTransaction", { id: "x1" })).error?.code).toBe(E.NOT_FOUND);
  });
  it("cancelled → -31008", async () => {
    await create("p1");
    await call("CancelTransaction", { id: "p1", reason: 3 });
    expect((await call("PerformTransaction", { id: "p1" })).error?.code).toBe(E.CANT_PERFORM);
  });
  it("timeout → cancelled (reason 4) and -31008, no payment", async () => {
    await create("p1");
    const r = await call("PerformTransaction", { id: "p1" }, { now: T0 + TIMEOUT_MS + 1 });
    expect(r.error?.code).toBe(E.CANT_PERFORM);
    expect(repo.txs[0]).toMatchObject({ state: -1, reason: 4 });
    expect(repo.ledger).toEqual([]);
  });
});

describe("CancelTransaction", () => {
  it("state 1 → -1 without touching the ledger, idempotent", async () => {
    await create("p1");
    const a = await call("CancelTransaction", { id: "p1", reason: 3 }, { now: T0 + 10 });
    expect(a.result).toEqual({ transaction: "our-1", cancel_time: T0 + 10, state: -1 });
    expect((await call("CancelTransaction", { id: "p1", reason: 3 }, { now: T0 + 99 })).result).toEqual(a.result);
    expect(repo.ledger).toEqual([]);
  });
  it("state 2 → -2 with a reversal of the payment, idempotent", async () => {
    await create("p1");
    await call("PerformTransaction", { id: "p1" }, { now: T0 + 1 });
    const a = await call("CancelTransaction", { id: "p1", reason: 5 }, { now: T0 + 2 });
    expect(a.result).toMatchObject({ state: -2, cancel_time: T0 + 2 });
    await call("CancelTransaction", { id: "p1", reason: 5 }, { now: T0 + 3 });
    expect(repo.ledger.map((l) => l.amount)).toEqual([600_000, -600_000]);
  });
  it("not found → -31003, missing reason → -32600", async () => {
    expect((await call("CancelTransaction", { id: "nope", reason: 1 })).error?.code).toBe(E.NOT_FOUND);
    await create("p1");
    expect((await call("CancelTransaction", { id: "p1" })).error?.code).toBe(E.INVALID);
  });
});

describe("CheckTransaction & GetStatement", () => {
  it("reports every field", async () => {
    await create("p1");
    await call("PerformTransaction", { id: "p1" }, { now: T0 + 1 });
    expect((await call("CheckTransaction", { id: "p1" })).result).toEqual({ create_time: T0, perform_time: T0 + 1, cancel_time: 0, transaction: "our-1", state: 2, reason: null });
    expect((await call("CheckTransaction", { id: "zz" })).error?.code).toBe(E.NOT_FOUND);
  });
  it("lists this center's transactions in the range", async () => {
    await create("p1");
    await call("CreateTransaction", { id: "x1", time: T0, amount: 100, account: { family_id: "famX" } }, { key: "other" });
    const r = (await call("GetStatement", { from: T0 - 1, to: T0 + 1 })).result as { transactions: { id: string; amount: number; account: object }[] };
    expect(r.transactions).toHaveLength(1);
    expect(r.transactions[0]).toMatchObject({ id: "p1", time: T0, amount: 60_000_000, account: { family_id: "fam1" }, state: 1 });
    expect(((await call("GetStatement", { from: T0 + 5, to: T0 + 9 })).result as { transactions: unknown[] }).transactions).toEqual([]);
  });
  it("selects and orders by Payme's time, not our create time (L5)", async () => {
    // Payme's clock runs 10 min behind ours, and its order differs from ours
    await call("CreateTransaction", { id: "a", time: T0 - 600_000 + 20, amount: 100, account: { family_id: "fam1" } }, { now: T0 });
    await call("CreateTransaction", { id: "b", time: T0 - 600_000 + 10, amount: 100, account: { family_id: "fam1" } }, { now: T0 + 1 });
    const list = async (from: number, to: number) => ((await call("GetStatement", { from, to })).result as { transactions: { id: string; time: number }[] }).transactions;
    expect((await list(T0 - 600_000, T0 - 590_000)).map((t) => [t.id, t.time])).toEqual([
      ["b", T0 - 600_000 + 10],
      ["a", T0 - 600_000 + 20],
    ]);
    expect(await list(T0, T0 + 10)).toEqual([]);
  });
});

describe("pay link", () => {
  it("encodes merchant, account, amount in tiyin", () => {
    const url = buildPayLink({ merchantId: "m123", familyId: "fam1", amountTiyin: 60_000_000, returnUrl: "https://x.uz/pay/fam1", test: true });
    expect(url.startsWith("https://checkout.test.paycom.uz/")).toBe(true);
    const decoded = Buffer.from(url.split("/").pop()!, "base64").toString();
    expect(decoded).toBe("m=m123;ac.family_id=fam1;a=60000000;c=https://x.uz/pay/fam1;l=uz");
  });
});
