// Notification queue on the real database: claim, retries, rate limits, unlinking. Run: npm run test:integration
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { MAX_ATTEMPTS, processNotifications, purgeOldNotifications, type Sender } from "@/worker/notifications";

let centerId = "";
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const tgError = (error_code: number, description: string, retry_after?: number) =>
  Object.assign(new Error(description), { error_code, description, ...(retry_after ? { parameters: { retry_after } } : {}) });

async function queue(chatId: string, n: number, extra: Record<string, unknown> = {}) {
  const ids: string[] = [];
  for (let i = 0; i < n; i++) {
    const row = await db.notification.create({ data: { centerId, chatId, text: `${chatId}#${i}`, createdAt: new Date(Date.now() - (n - i) * 1000), ...extra } });
    ids.push(row.id);
  }
  return ids;
}

beforeAll(async () => {
  const c = await db.center.upsert({ where: { slug: "notif-test" }, update: {}, create: { name: "Notif test", slug: "notif-test" } });
  centerId = c.id;
});

beforeEach(async () => {
  await db.notification.deleteMany({ where: { centerId } });
  // the queue is global: park rows other test files queued so every batch here sees only this file's rows
  await db.notification.updateMany({
    where: { centerId: { not: centerId }, status: { in: ["PENDING", "SENDING"] } },
    data: { status: "PENDING", lockedAt: null, nextAttemptAt: new Date(Date.now() + 365 * 86_400_000) },
  });
});

describe("notification queue", () => {
  it("passes a row's rich form to the sender (null when it has none)", async () => {
    await queue("1010", 1, { richText: "<h3>rich</h3>" });
    await queue("1011", 1);
    const seen: (string | null | undefined)[] = [];
    const r = await processNotifications(async (_c, _t, meta) => void seen.push(meta.rich), { gapMs: 0 });
    expect(r.sent).toBe(2);
    expect(seen).toEqual(["<h3>rich</h3>", null]);
  });

  it("two workers at once send every row exactly once", async () => {
    await queue("1001", 40);
    const seen: string[] = [];
    const send: Sender = async (_chat, text) => {
      seen.push(text);
      await sleep(2);
    };
    const [a, b] = await Promise.all([processNotifications(send, { limit: 25, gapMs: 0 }), processNotifications(send, { limit: 25, gapMs: 0 })]);
    // whatever the first two batches left is picked up by a third run
    const c = await processNotifications(send, { gapMs: 0 });
    expect(a.sent + b.sent + c.sent).toBe(40);
    expect(new Set(seen).size).toBe(40);
    expect(seen.length).toBe(40);
    expect(await db.notification.count({ where: { centerId, status: "SENT" } })).toBe(40);
  });

  it("429 waits retry_after, counts no attempt and stops the batch", async () => {
    await queue("1002", 3);
    let calls = 0;
    const r = await processNotifications(
      async () => {
        calls++;
        throw tgError(429, "Too Many Requests: retry after 30", 30);
      },
      { gapMs: 0 },
    );
    expect(calls).toBe(1);
    expect(r).toMatchObject({ sent: 0, failed: 0, rateLimitedMs: 30_000 });
    const rows = await db.notification.findMany({ where: { centerId } });
    for (const row of rows) {
      expect(row.status).toBe("PENDING");
      expect(row.attempts).toBe(0);
      expect(row.nextAttemptAt.getTime()).toBeGreaterThan(Date.now() + 25_000);
    }
    // nothing is due yet
    const again = await processNotifications(async () => void calls++, { gapMs: 0 });
    expect(again.sent).toBe(0);
    expect(calls).toBe(1);
  });

  it("network errors back off exponentially and fail after the last attempt", async () => {
    const [id] = await queue("1003", 1);
    const boom: Sender = async () => {
      throw new Error("ETIMEDOUT");
    };
    const r = await processNotifications(boom, { gapMs: 0 });
    expect(r.retried).toBe(1);
    let row = await db.notification.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: "PENDING", attempts: 1, error: "ETIMEDOUT", lockedAt: null });
    const wait = row.nextAttemptAt.getTime() - Date.now();
    expect(wait).toBeGreaterThan(25_000);
    expect(wait).toBeLessThan(35_000);

    await db.notification.update({ where: { id }, data: { attempts: MAX_ATTEMPTS - 1, nextAttemptAt: new Date(Date.now() - 1000) } });
    await processNotifications(boom, { gapMs: 0 });
    row = await db.notification.findUniqueOrThrow({ where: { id } });
    expect(row).toMatchObject({ status: "FAILED", attempts: MAX_ATTEMPTS });
  });

  it("403 (bot blocked) fails the row and unlinks that chat everywhere", async () => {
    const chat = "1004";
    const family = await db.family.create({ data: { centerId, name: "Blocked family" } });
    const guardian = await db.guardian.create({ data: { familyId: family.id, name: "G", phone: "998900000104", telegramChatId: chat } });
    const student = await db.student.create({ data: { centerId, familyId: family.id, firstName: "S", lastName: "T", telegramChatId: chat } });
    const user = await db.user.upsert({
      where: { phone: "998900000105" },
      update: { telegramChatId: chat },
      create: { centerId, phone: "998900000105", name: "Staff", passwordHash: "x", role: "ADMIN", perms: [], telegramChatId: chat },
    });
    await db.telegramLink.createMany({
      data: [
        { chatId: chat, kind: "GUARDIAN", refId: guardian.id, phone: guardian.phone },
        { chatId: chat, kind: "STUDENT", refId: student.id, phone: guardian.phone },
      ],
      skipDuplicates: true,
    });
    await queue(chat, 2);
    await queue("1005", 1);
    const sentTo: string[] = [];
    const r = await processNotifications(
      async (c) => {
        if (c === chat) throw tgError(403, "Forbidden: bot was blocked by the user");
        sentTo.push(c);
      },
      { gapMs: 0 },
    );
    expect(r).toMatchObject({ sent: 1, failed: 2, unlinked: 1 });
    expect(sentTo).toEqual(["1005"]);
    expect(await db.notification.count({ where: { chatId: chat, status: "FAILED" } })).toBe(2);
    expect(await db.telegramLink.count({ where: { chatId: chat } })).toBe(0);
    expect((await db.guardian.findUniqueOrThrow({ where: { id: guardian.id } })).telegramChatId).toBeNull();
    expect((await db.student.findUniqueOrThrow({ where: { id: student.id } })).telegramChatId).toBeNull();
    expect((await db.user.findUniqueOrThrow({ where: { id: user.id } })).telegramChatId).toBeNull();
  });

  it("400 chat not found unlinks; other 400s fail without retry and keep the link", async () => {
    await db.telegramLink.createMany({ data: [{ chatId: "1006", kind: "GUARDIAN", refId: "g-1006", phone: "998900000106" }, { chatId: "1007", kind: "GUARDIAN", refId: "g-1007", phone: "998900000107" }], skipDuplicates: true });
    await queue("1006", 1);
    await queue("1007", 1);
    const r = await processNotifications(
      async (c) => {
        throw c === "1006" ? tgError(400, "Bad Request: chat not found") : tgError(400, "Bad Request: can't parse entities");
      },
      { gapMs: 0 },
    );
    expect(r).toMatchObject({ failed: 2, unlinked: 1, retried: 0 });
    expect(await db.telegramLink.count({ where: { chatId: "1006" } })).toBe(0);
    expect(await db.telegramLink.count({ where: { chatId: "1007" } })).toBe(1);
    expect(await db.notification.findFirstOrThrow({ where: { chatId: "1007" } })).toMatchObject({ status: "FAILED", attempts: 1 });
    await db.telegramLink.deleteMany({ where: { chatId: "1007" } });
  });

  it("rows a crashed worker left in SENDING are taken back after 10 minutes", async () => {
    const [stale] = await queue("1008", 1, { status: "SENDING", lockedAt: new Date(Date.now() - 11 * 60_000) });
    const [fresh] = await queue("1009", 1, { status: "SENDING", lockedAt: new Date(Date.now() - 60_000) });
    const r = await processNotifications(async () => {}, { gapMs: 0 });
    expect(r).toMatchObject({ reclaimed: 1, sent: 1 });
    expect((await db.notification.findUniqueOrThrow({ where: { id: stale } })).status).toBe("SENT");
    expect((await db.notification.findUniqueOrThrow({ where: { id: fresh } })).status).toBe("SENDING");
  });

  it("an aborted run gives untried rows back", async () => {
    await queue("1010", 5);
    const ac = new AbortController();
    let n = 0;
    const r = await processNotifications(
      async () => {
        if (++n === 2) ac.abort();
      },
      { gapMs: 0, signal: ac.signal },
    );
    expect(r.sent).toBe(2);
    expect(await db.notification.count({ where: { centerId, status: "PENDING", lockedAt: null } })).toBe(3);
  });

  it("retention drops SENT after 90 days and FAILED after 180 days", async () => {
    const day = 86_400_000;
    const at = (d: number) => new Date(Date.now() - d * day);
    await db.notification.createMany({
      data: [
        { centerId, chatId: "1011", text: "old sent", status: "SENT", createdAt: at(91) },
        { centerId, chatId: "1011", text: "new sent", status: "SENT", createdAt: at(30) },
        { centerId, chatId: "1011", text: "old failed", status: "FAILED", createdAt: at(181) },
        { centerId, chatId: "1011", text: "mid failed", status: "FAILED", createdAt: at(120) },
        { centerId, chatId: "1011", text: "old pending", status: "PENDING", createdAt: at(400), nextAttemptAt: new Date(Date.now() + day) },
      ],
    });
    expect(await purgeOldNotifications()).toEqual({ sent: 1, failed: 1 });
    const left = (await db.notification.findMany({ where: { centerId }, select: { text: true } })).map((x) => x.text).sort();
    expect(left).toEqual(["mid failed", "new sent", "old pending"]);
  });
});
