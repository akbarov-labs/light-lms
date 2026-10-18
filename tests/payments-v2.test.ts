// Click and Uzum on the database: ledger rows, idempotency, reversal, routing by service id, the pay page rule.
// Run: npm run test:integration
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { clickSign, handleClick, type ClickParams } from "@/lib/payments/click";
import { prismaClickRepo } from "@/lib/payments/click-repo";
import { handleUzum } from "@/lib/payments/uzum";
import { prismaUzumRepo } from "@/lib/payments/uzum-repo";
import { familyBalance } from "@/lib/services/wallet";
import { payLinkForFamily } from "@/lib/payments/links";

let centerId = "";
let familyId = "";
let otherFamilyId = "";
const SECRET = "click-secret-it";

beforeAll(async () => {
  const slug = `v2pay-${Date.now()}`;
  const c = await db.center.create({ data: { name: "V2 Pay", slug, clickServiceId: `${slug}-svc`, clickMerchantId: "55", clickSecretKey: SECRET, uzumServiceId: `${slug}-uz`, uzumLogin: "lms", uzumPassword: "pw" } });
  centerId = c.id;
  familyId = (await db.family.create({ data: { centerId, name: "Click oilasi" } })).id;
  const other = await db.center.create({ data: { name: "Other", slug: `${slug}-o` } });
  otherFamilyId = (await db.family.create({ data: { centerId: other.id, name: "Begona" } })).id;
});

const svc = async () => (await db.center.findUniqueOrThrow({ where: { id: centerId } })).clickServiceId!;
async function click(action: 0 | 1, over: ClickParams) {
  const p: ClickParams = { click_trans_id: "7001", service_id: await svc(), click_paydoc_id: "1", merchant_trans_id: familyId, amount: "150000", action: String(action), error: "0", error_note: "Success", sign_time: "2026-10-18 10:00:00", ...over };
  return handleClick({ ...p, sign_string: clickSign(p, SECRET) }, prismaClickRepo, action);
}

describe("Click on the database", () => {
  it("Prepare → Complete posts one CLICK payment; retries post nothing", async () => {
    const before = await familyBalance(familyId);
    const prep = await click(0, {});
    expect(prep.error).toBe(0);
    const id = String(prep.merchant_prepare_id);
    expect((await click(0, {})).merchant_prepare_id).toBe(prep.merchant_prepare_id);
    expect((await click(1, { merchant_prepare_id: id })).error).toBe(0);
    expect((await click(1, { merchant_prepare_id: id })).error).toBe(-4);
    expect(await familyBalance(familyId)).toBe(before + 150_000);
    const entry = await db.ledgerEntry.findFirstOrThrow({ where: { externalId: "7001", method: "CLICK" } });
    expect(entry).toMatchObject({ type: "PAYMENT", amount: 150_000, familyId });
    expect((await db.clickTransaction.findUniqueOrThrow({ where: { clickTransId: "7001" } })).ledgerEntryId).toBe(entry.id);
  });
  it("a failed Click payment is cancelled and never posts money", async () => {
    const before = await familyBalance(familyId);
    const prep = await click(0, { click_trans_id: "7002" });
    expect((await click(1, { click_trans_id: "7002", merchant_prepare_id: String(prep.merchant_prepare_id), error: "-5017" })).error).toBe(-9);
    expect(await familyBalance(familyId)).toBe(before);
    expect((await db.clickTransaction.findUniqueOrThrow({ where: { clickTransId: "7002" } })).state).toBe(-1);
  });
  it("another center's family is refused (-5)", async () => {
    expect((await click(0, { click_trans_id: "7003", merchant_trans_id: otherFamilyId })).error).toBe(-5);
  });
});

describe("Uzum on the database", () => {
  const auth = `Basic ${Buffer.from("lms:pw").toString("base64")}`;
  const call = async (op: string, body: object, now = Date.now()) => {
    const serviceId = (await db.center.findUniqueOrThrow({ where: { id: centerId } })).uzumServiceId;
    return handleUzum(op, { auth, body: JSON.stringify({ serviceId, timestamp: now, ...body }) }, prismaUzumRepo, now);
  };
  it("create → confirm → reverse moves the wallet up and back down", async () => {
    const before = await familyBalance(familyId);
    expect((await call("check", { params: { account: familyId } })).body.status).toBe("OK");
    expect((await call("create", { transId: "uz-1", amount: 20_000_000, params: { account: familyId } })).body.status).toBe("CREATED");
    expect((await call("confirm", { transId: "uz-1" })).body.status).toBe("CONFIRMED");
    expect((await call("confirm", { transId: "uz-1" })).body.status).toBe("CONFIRMED");
    expect(await familyBalance(familyId)).toBe(before + 200_000);
    expect(await db.ledgerEntry.count({ where: { externalId: "uz-1", method: "UZUM", type: "PAYMENT" } })).toBe(1);
    expect((await call("reverse", { transId: "uz-1" })).body.status).toBe("REVERSED");
    expect((await call("reverse", { transId: "uz-1" })).body.status).toBe("REVERSED");
    expect(await familyBalance(familyId)).toBe(before);
    expect(await db.ledgerEntry.count({ where: { familyId, type: "REVERSAL", method: "UZUM" } })).toBe(1);
  });
  it("a concurrent duplicate create returns the same row", async () => {
    const [a, b] = await Promise.all([1, 2].map(() => call("create", { transId: "uz-race", amount: 1_000_000, params: { account: familyId } })));
    expect(a.body.status).toBe("CREATED");
    expect(b.body.status).toBe("CREATED");
    expect(await db.uzumTransaction.count({ where: { transId: "uz-race" } })).toBe(1);
  });
  it("wrong password → 401", async () => {
    const serviceId = (await db.center.findUniqueOrThrow({ where: { id: centerId } })).uzumServiceId;
    const r = await handleUzum("check", { auth: `Basic ${Buffer.from("lms:x").toString("base64")}`, body: JSON.stringify({ serviceId, params: { account: familyId } }) }, prismaUzumRepo);
    expect(r.status).toBe(401);
  });
});

describe("pay links", () => {
  it("any connected provider gives the family a pay page; none → null", async () => {
    expect(await payLinkForFamily(familyId)).toMatch(new RegExp(`/pay/${familyId}$`));
    expect(await payLinkForFamily(otherFamilyId)).toBeNull();
  });
});
