import { beforeEach, describe, expect, it } from "vitest";
import { buildClickLink, clickAmount, clickSign, CLICK_E, handleClick, type ClickParams, type ClickRepo, type ClickTx } from "./click";

const SECRET = "click-secret";

class MemRepo implements ClickRepo {
  txs: ClickTx[] = [];
  ledger: { amount: number; txId: string }[] = [];
  seq = 100;
  families = new Map([
    ["fam1", { id: "fam1", centerId: "c1" }],
    ["famX", { id: "famX", centerId: "c2" }],
  ]);
  async centerByService(serviceId: string) {
    return serviceId === "777" ? { id: "c1", secretKey: SECRET } : serviceId === "888" ? { id: "c2", secretKey: "other" } : null;
  }
  async family(id: string) {
    return this.families.get(id) ?? null;
  }
  async byClickId(id: string) {
    return this.txs.find((t) => t.clickTransId === id) ?? null;
  }
  async byPrepareId(id: number) {
    return this.txs.find((t) => t.prepareId === id) ?? null;
  }
  async prepare(tx: { centerId: string; clickTransId: string; familyId: string; amount: number }) {
    const t: ClickTx = { ...tx, id: `our-${this.txs.length + 1}`, prepareId: ++this.seq, state: 0 };
    this.txs.push(t);
    return t;
  }
  async confirm(tx: ClickTx) {
    if (tx.state !== 0) return tx;
    this.ledger.push({ amount: tx.amount, txId: tx.id });
    tx.state = 1;
    return tx;
  }
  async cancel(tx: ClickTx) {
    if (tx.state === 0) tx.state = -1;
    return tx;
  }
}

let repo: MemRepo;
beforeEach(() => {
  repo = new MemRepo();
});

function signed(p: ClickParams, secret = SECRET): ClickParams {
  return { ...p, sign_string: clickSign(p, secret) };
}
const prepareReq = (over: ClickParams = {}) =>
  signed({ click_trans_id: "5001", service_id: "777", click_paydoc_id: "9001", merchant_trans_id: "fam1", amount: "250000.00", action: "0", error: "0", error_note: "Success", sign_time: "2026-10-18 10:00:00", ...over });
const completeReq = (prepareId: number, over: ClickParams = {}) =>
  signed({ click_trans_id: "5001", service_id: "777", click_paydoc_id: "9001", merchant_trans_id: "fam1", merchant_prepare_id: String(prepareId), amount: "250000.00", action: "1", error: "0", error_note: "Success", sign_time: "2026-10-18 10:00:05", ...over });

describe("Click signature and request checks", () => {
  it("sign is md5 over the documented fields; Complete adds merchant_prepare_id", () => {
    const p = prepareReq();
    expect(p.sign_string).toMatch(/^[0-9a-f]{32}$/);
    const c = completeReq(5);
    expect(clickSign({ ...c, merchant_prepare_id: "6" }, SECRET)).not.toBe(c.sign_string);
    expect(clickSign({ ...p, merchant_prepare_id: "6" }, SECRET)).toBe(p.sign_string); // ignored for Prepare
  });
  it("missing fields → -8, bad sign → -1, unknown service → -1, bad action → -3", async () => {
    const { sign_time: _, ...noTime } = prepareReq();
    expect((await handleClick(noTime, repo)).error).toBe(CLICK_E.REQUEST);
    expect((await handleClick({ ...prepareReq(), action: "1" }, repo)).error).toBe(CLICK_E.REQUEST); // complete without prepare id
    expect((await handleClick({ ...prepareReq(), sign_string: "0".repeat(32) }, repo)).error).toBe(CLICK_E.SIGN);
    expect((await handleClick(prepareReq({ service_id: "999" }), repo)).error).toBe(CLICK_E.SIGN);
    expect((await handleClick(prepareReq({ action: "5" }), repo)).error).toBe(CLICK_E.ACTION);
    expect((await handleClick(prepareReq(), repo, 1)).error).toBe(CLICK_E.ACTION); // prepare sent to /complete
  });
  it("unknown family or another center's family → -5", async () => {
    expect((await handleClick(prepareReq({ merchant_trans_id: "nope" }), repo)).error).toBe(CLICK_E.USER);
    expect((await handleClick(prepareReq({ merchant_trans_id: "famX" }), repo)).error).toBe(CLICK_E.USER);
  });
  it("amounts: whole so'm only", () => {
    expect(clickAmount("1000")).toBe(1000);
    expect(clickAmount("1000.00")).toBe(1000);
    expect(clickAmount("1000.50")).toBeNull();
    expect(clickAmount("0")).toBeNull();
    expect(clickAmount("-5")).toBeNull();
    expect(clickAmount("1e5")).toBeNull();
    expect(clickAmount("200000000")).toBeNull();
  });
});

describe("Click Prepare → Complete", () => {
  it("happy path posts one PAYMENT and echoes ids", async () => {
    const r = await handleClick(prepareReq(), repo, 0);
    expect(r).toMatchObject({ error: 0, click_trans_id: 5001, merchant_trans_id: "fam1", merchant_prepare_id: 101 });
    const c = await handleClick(completeReq(101), repo, 1);
    expect(c).toMatchObject({ error: 0, merchant_confirm_id: 101 });
    expect(repo.ledger).toEqual([{ amount: 250000, txId: "our-1" }]);
  });
  it("Prepare is idempotent; a second Complete answers -4 and posts nothing", async () => {
    await handleClick(prepareReq(), repo);
    expect((await handleClick(prepareReq(), repo)).merchant_prepare_id).toBe(101);
    expect(repo.txs).toHaveLength(1);
    await handleClick(completeReq(101), repo);
    expect((await handleClick(completeReq(101), repo)).error).toBe(CLICK_E.ALREADY_PAID);
    expect((await handleClick(prepareReq(), repo)).error).toBe(CLICK_E.ALREADY_PAID);
    expect(repo.ledger).toHaveLength(1);
  });
  it("bad amount on Prepare, or a different amount on Complete → -2", async () => {
    expect((await handleClick(prepareReq({ amount: "100.50" }), repo)).error).toBe(CLICK_E.AMOUNT);
    await handleClick(prepareReq(), repo);
    expect((await handleClick(completeReq(101, { amount: "1000" }), repo)).error).toBe(CLICK_E.AMOUNT);
    expect((await handleClick(prepareReq({ amount: "1000" }), repo)).error).toBe(CLICK_E.AMOUNT); // same click id, other amount
    expect(repo.ledger).toHaveLength(0);
  });
  it("unknown prepare id or a prepare id of another click payment → -6", async () => {
    await handleClick(prepareReq(), repo);
    expect((await handleClick(completeReq(999), repo)).error).toBe(CLICK_E.NO_TX);
    expect((await handleClick(completeReq(101, { click_trans_id: "5002" }), repo)).error).toBe(CLICK_E.NO_TX);
  });
  it("Click reports a failed payment (error < 0) → cancelled, -9, and stays cancelled", async () => {
    await handleClick(prepareReq(), repo);
    expect((await handleClick(completeReq(101, { error: "-5017", error_note: "Insufficient funds" }), repo)).error).toBe(CLICK_E.CANCELLED);
    expect(repo.txs[0].state).toBe(-1);
    expect((await handleClick(completeReq(101), repo)).error).toBe(CLICK_E.CANCELLED);
    expect((await handleClick(prepareReq(), repo)).error).toBe(CLICK_E.CANCELLED);
    expect(repo.ledger).toHaveLength(0);
  });
  it("a click id another center prepared is not visible", async () => {
    await handleClick(prepareReq(), repo);
    repo.txs[0].centerId = "c2";
    expect((await handleClick(prepareReq(), repo)).error).toBe(CLICK_E.NO_TX);
  });
  it("a repo failure answers -7, never throws", async () => {
    repo.prepare = async () => {
      throw new Error("db down");
    };
    expect((await handleClick(prepareReq(), repo)).error).toBe(CLICK_E.UPDATE);
  });
  it("a confirm that lost to a cancel answers -9", async () => {
    await handleClick(prepareReq(), repo);
    repo.confirm = async (tx) => ({ ...tx, state: -1 });
    expect((await handleClick(completeReq(101), repo)).error).toBe(CLICK_E.CANCELLED);
  });
});

describe("Click pay link", () => {
  it("my.click.uz with service, merchant, amount and the family as transaction_param", () => {
    const u = new URL(buildClickLink({ serviceId: "777", merchantId: "55", familyId: "fam1", amount: 250000, returnUrl: "https://x.uz/pay/fam1" }));
    expect(u.origin + u.pathname).toBe("https://my.click.uz/services/pay");
    expect(Object.fromEntries(u.searchParams)).toEqual({ service_id: "777", merchant_id: "55", amount: "250000", transaction_param: "fam1", return_url: "https://x.uz/pay/fam1" });
  });
});
