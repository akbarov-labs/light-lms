// Family balance cache (src/lib/billing/balance-cache.ts) on the real database: the LedgerEntry trigger
// queues every change, the refresher matches the wallet's allocation exactly, and concurrent writes
// during a refresh are never lost. Run: npm run test:integration
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { addDays, fromISODate, todayISO } from "@/lib/dates";
import { debtSummary } from "@/lib/billing/allocation";
import { freshBalances, parseDues, refreshAllBalances } from "@/lib/billing/balance-cache";
import { familyAllocation } from "@/lib/services/wallet";

const today = todayISO();
let centerId = "";

const queued = async (familyId: string) => db.familyBalanceDirty.count({ where: { familyId } });
const cached = async (familyId: string) => {
  const b = await db.familyBalance.findUnique({ where: { familyId } });
  return b && { balance: Number(b.balance), totalDebt: Number(b.totalDebt), oldestUnpaidDate: b.oldestUnpaidDate ? b.oldestUnpaidDate.toISOString().slice(0, 10) : null, dues: parseDues(b.dues) };
};
const truth = async (familyId: string) => debtSummary(await familyAllocation(familyId));
async function family(name: string) {
  return (await db.family.create({ data: { centerId, name } })).id;
}
const entry = (familyId: string, type: "CHARGE" | "PAYMENT" | "REFUND", amount: number, daysAgo: number, extra: object = {}) => ({
  centerId, familyId, type, amount, description: type, date: fromISODate(addDays(today, -daysAgo)), ...extra,
});

beforeAll(async () => {
  centerId = (await db.center.create({ data: { name: "Kesh markazi", slug: "balance-cache" } })).id;
});

describe("trigger", () => {
  it("one statement queues each family once, whatever the number of rows", async () => {
    const f = await family("A");
    await db.ledgerEntry.createMany({ data: [entry(f, "CHARGE", -100_000, 40), entry(f, "CHARGE", -100_000, 10), entry(f, "PAYMENT", 50_000, 5)] });
    expect(await queued(f)).toBe(1);
    expect(await freshBalances(centerId)).toBeGreaterThanOrEqual(1);
    expect(await queued(f)).toBe(0);
    expect(await cached(f)).toEqual(await truth(f));
    expect(await cached(f)).toMatchObject({ balance: -150_000, totalDebt: 150_000, dues: [{ date: addDays(today, -40), amount: 50_000 }, { date: addDays(today, -10), amount: 100_000 }] });
  });

  it("updates and deletes queue the family too", async () => {
    const f = await family("B");
    const e = await db.ledgerEntry.create({ data: entry(f, "CHARGE", -80_000, 3) });
    await freshBalances(centerId);
    await db.ledgerEntry.update({ where: { id: e.id }, data: { amount: -90_000 } });
    expect(await queued(f)).toBe(1);
    await freshBalances(centerId);
    expect((await cached(f))?.balance).toBe(-90_000);
    await db.ledgerEntry.delete({ where: { id: e.id } });
    await freshBalances(centerId);
    expect(await cached(f)).toEqual({ balance: 0, totalDebt: 0, oldestUnpaidDate: null, dues: [] });
  });

  it("a deleted family leaves only queue rows, which the refresher drops", async () => {
    const f = await family("C");
    await db.ledgerEntry.create({ data: entry(f, "CHARGE", -10_000, 1) });
    await freshBalances(centerId);
    await db.ledgerEntry.deleteMany({ where: { familyId: f } });
    await db.family.delete({ where: { id: f } });
    expect(await db.familyBalance.count({ where: { familyId: f } })).toBe(0); // cascade
    expect(await queued(f)).toBe(1);
    await freshBalances(centerId);
    expect(await queued(f)).toBe(0);
  });

  it("nothing queued: the read path is one probe and changes nothing", async () => {
    await freshBalances(centerId);
    expect(await freshBalances(centerId)).toBe(0);
  });
});

describe("concurrency", () => {
  it("a write that commits while a refresh runs keeps its family queued", async () => {
    const f = await family("D");
    await db.ledgerEntry.create({ data: entry(f, "CHARGE", -200_000, 20) });
    await freshBalances(centerId);
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    let inserted!: () => void;
    const didInsert = new Promise<void>((r) => (inserted = r));
    // a payment inserted (trigger fired) but not committed yet
    const writer = db.$transaction(async (tx) => {
      await tx.ledgerEntry.create({ data: entry(f, "PAYMENT", 200_000, 0) });
      inserted();
      await gate;
    });
    await didInsert;
    await freshBalances(centerId); // cannot see the uncommitted payment or its queue row
    release();
    await writer;
    expect(await queued(f)).toBe(1);
    expect((await cached(f))?.balance).toBe(-200_000);
    await freshBalances(centerId);
    expect((await cached(f))?.balance).toBe(0);
  });

  it("parallel refreshers and writers end with the cache equal to the ledger", async () => {
    const fams = await Promise.all(Array.from({ length: 12 }, (_, i) => family(`P${i}`)));
    const writes = fams.flatMap((f, i) =>
      Array.from({ length: 6 }, (_, k) => db.ledgerEntry.create({ data: entry(f, k % 3 === 2 ? "PAYMENT" : "CHARGE", k % 3 === 2 ? 70_000 + i : -50_000 - k, 60 - k * 9) })),
    );
    const refreshers = Array.from({ length: 6 }, () => freshBalances(centerId, 3));
    await Promise.all([...writes, ...refreshers]);
    await freshBalances(centerId);
    for (const f of fams) expect(await cached(f), f).toEqual(await truth(f));
  });
});

describe("whole database", () => {
  it("every family of every center: cache = SUM(ledger) and = the wallet allocation", async () => {
    await refreshAllBalances();
    expect(await db.familyBalanceDirty.count()).toBe(0);
    const sums = await db.ledgerEntry.groupBy({ by: ["familyId"], _sum: { amount: true } });
    expect(sums.length).toBeGreaterThan(10);
    const rows = new Map((await db.familyBalance.findMany()).map((b) => [b.familyId, b]));
    for (const s of sums) {
      expect(Number(rows.get(s.familyId)?.balance), s.familyId).toBe(s._sum.amount ?? 0);
      expect(await cached(s.familyId), s.familyId).toEqual(await truth(s.familyId));
    }
  });
});
