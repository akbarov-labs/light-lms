import { beforeEach, describe, expect, it } from "vitest";
import { buildUzumLink, handleUzum, UZUM_E, type UzumRepo, type UzumTx } from "./uzum";

const T0 = 1_790_000_000_000;
const auth = (login = "lms", password = "pw") => `Basic ${Buffer.from(`${login}:${password}`).toString("base64")}`;

class MemRepo implements UzumRepo {
  txs: UzumTx[] = [];
  ledger: { type: "PAYMENT" | "REVERSAL"; amount: number }[] = [];
  families = new Map([
    ["fam1", { id: "fam1", centerId: "c1" }],
    ["famX", { id: "famX", centerId: "c2" }],
  ]);
  async centerByService(id: string) {
    return id === "101" ? { id: "c1", login: "lms", password: "pw" } : id === "202" ? { id: "c2", login: "b", password: "b" } : null;
  }
  async family(id: string) {
    return this.families.get(id) ?? null;
  }
  async findTx(id: string) {
    return this.txs.find((t) => t.transId === id) ?? null;
  }
  async createTx(tx: Omit<UzumTx, "id" | "state" | "confirmTime" | "reverseTime">) {
    const t: UzumTx = { ...tx, id: `our-${this.txs.length + 1}`, state: "CREATED", confirmTime: null, reverseTime: null };
    this.txs.push(t);
    return t;
  }
  async confirm(tx: UzumTx, now: number) {
    if (tx.state !== "CREATED") return tx;
    this.ledger.push({ type: "PAYMENT", amount: tx.amountTiyin / 100 });
    Object.assign(tx, { state: "CONFIRMED", confirmTime: now });
    return tx;
  }
  async reverse(tx: UzumTx, now: number) {
    if (tx.state === "CONFIRMED") this.ledger.push({ type: "REVERSAL", amount: -tx.amountTiyin / 100 });
    Object.assign(tx, { state: "REVERSED", reverseTime: now });
    return tx;
  }
}

let repo: MemRepo;
beforeEach(() => {
  repo = new MemRepo();
});
const call = (op: string, body: object, opts: { auth?: string; now?: number; raw?: string } = {}) =>
  handleUzum(op, { auth: opts.auth ?? auth(), body: opts.raw ?? JSON.stringify({ serviceId: 101, timestamp: T0, ...body }) }, repo, opts.now ?? T0);
const create = (transId = "u-1", amount = 25_000_000, account: unknown = "fam1") => call("create", { transId, amount, params: { account } });

describe("Uzum auth and protocol", () => {
  it("bad JSON → 10002, no serviceId → 10005, unknown service → 10006, wrong login → 10001 (401)", async () => {
    expect((await call("check", {}, { raw: "{oops" })).body.errorCode).toBe(String(UZUM_E.JSON));
    expect((await call("check", {}, { raw: JSON.stringify({ params: {} }) })).body.errorCode).toBe(String(UZUM_E.MISSING));
    expect((await call("check", {}, { raw: JSON.stringify({ serviceId: 999 }) })).body.errorCode).toBe(String(UZUM_E.SERVICE));
    const r = await call("check", { params: { account: "fam1" } }, { auth: auth("lms", "nope") });
    expect(r).toMatchObject({ status: 401, body: { status: "FAILED", errorCode: String(UZUM_E.ACCESS_DENIED), serviceId: 101 } });
    expect((await call("check", {}, { auth: "" })).status).toBe(401);
  });
  it("unknown operation → 10003", async () => {
    expect((await call("explode", {})).body.errorCode).toBe(String(UZUM_E.OPERATION));
  });
});

describe("Uzum check / create / confirm / reverse / status", () => {
  it("check finds the family (plain or { value } account), refuses other centers' families", async () => {
    expect((await call("check", { params: { account: "fam1" } })).body).toMatchObject({ status: "OK", data: { account: { value: "fam1" } } });
    expect((await call("check", { params: { account: { value: "fam1" } } })).body.status).toBe("OK");
    expect((await call("check", { params: { account: "famX" } })).body.errorCode).toBe(String(UZUM_E.ACCOUNT));
    expect((await call("check", { params: {} })).body.errorCode).toBe(String(UZUM_E.MISSING));
  });
  it("happy path: create → confirm posts one PAYMENT; repeats are idempotent", async () => {
    expect((await create()).body).toMatchObject({ status: "CREATED", transId: "u-1", transTime: T0, amount: 25_000_000 });
    expect((await create()).body.status).toBe("CREATED");
    expect(repo.txs).toHaveLength(1);
    expect((await call("confirm", { transId: "u-1" }, { now: T0 + 5 })).body).toMatchObject({ status: "CONFIRMED", confirmTime: T0 + 5 });
    expect((await call("confirm", { transId: "u-1" })).body.status).toBe("CONFIRMED");
    expect(repo.ledger).toEqual([{ type: "PAYMENT", amount: 250_000 }]);
    expect((await call("status", { transId: "u-1" })).body).toMatchObject({ status: "CONFIRMED", transTime: T0, confirmTime: T0 + 5, reverseTime: null });
  });
  it("amount must be whole so'm in tiyin, positive, not absurd → 10011", async () => {
    for (const a of [0, -100, 150, 1.5, "100", 100_000_000 * 100 + 100]) expect((await create("u-x", a as number)).body.errorCode).toBe(String(UZUM_E.AMOUNT));
    expect(repo.txs).toHaveLength(0);
  });
  it("the same transId for another payment → 10010", async () => {
    await create();
    expect((await create("u-1", 100_000)).body.errorCode).toBe(String(UZUM_E.TRANS_EXISTS));
  });
  it("reverse after confirm posts a REVERSAL; reverse is idempotent; confirm after reverse → 10015", async () => {
    await create();
    await call("confirm", { transId: "u-1" });
    expect((await call("reverse", { transId: "u-1" }, { now: T0 + 9 })).body).toMatchObject({ status: "REVERSED", reverseTime: T0 + 9 });
    expect((await call("reverse", { transId: "u-1" })).body.status).toBe("REVERSED");
    expect(repo.ledger.map((l) => l.type)).toEqual(["PAYMENT", "REVERSAL"]);
    expect((await call("confirm", { transId: "u-1" })).body.errorCode).toBe(String(UZUM_E.TRANS_CANCELLED));
    expect((await create()).body.errorCode).toBe(String(UZUM_E.TRANS_CANCELLED));
  });
  it("reverse before confirm cancels without money", async () => {
    await create();
    await call("reverse", { transId: "u-1" });
    expect(repo.ledger).toEqual([]);
  });
  it("unknown transaction → 10014; another center's transaction is not found", async () => {
    expect((await call("confirm", { transId: "nope" })).body.errorCode).toBe(String(UZUM_E.NOT_FOUND));
    await create();
    repo.txs[0].centerId = "c2";
    expect((await call("status", { transId: "u-1" })).body.errorCode).toBe(String(UZUM_E.NOT_FOUND));
  });
  it("a confirm that lost to a reverse answers 10015; a repo crash answers 99999 (500)", async () => {
    await create();
    repo.confirm = async (tx) => ({ ...tx, state: "REVERSED" });
    expect((await call("confirm", { transId: "u-1" })).body.errorCode).toBe(String(UZUM_E.TRANS_CANCELLED));
    repo.findTx = async () => {
      throw new Error("db down");
    };
    const r = await call("status", { transId: "u-1" });
    expect(r).toMatchObject({ status: 500, body: { errorCode: String(UZUM_E.SYSTEM) } });
  });
});

describe("Uzum pay link", () => {
  it("open-service with serviceId, amount in tiyin and the family as account", () => {
    const u = new URL(buildUzumLink({ serviceId: "101", familyId: "fam1", amount: 250_000 }));
    expect(Object.fromEntries(u.searchParams)).toEqual({ serviceId: "101", amount: "25000000", account: "fam1" });
  });
});
