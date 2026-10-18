// SMS on the database: who gets one, dedupe, the separate SMS queue, the Eskiz sender's refusals.
// Run: npm run test:integration
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { notifyFamily } from "@/lib/notify";
import { msg } from "@/lib/messages";
import { processNotifications, type Sender } from "@/worker/notifications";
import { smsSender } from "@/worker/sms-sender";

let centerId = "";
let plainFamily = "";
let tgFamily = "";

const debt = (familyId: string, key: string) =>
  db.$transaction((tx) => notifyFamily(tx, { centerId, familyId, event: "debt", text: (l) => msg.debt(l, { center: "SMS markaz", debt: 250_000, payUrl: null }), dedupeKey: key }));
const setSms = (sms: Prisma.InputJsonValue) => db.center.update({ where: { id: centerId }, data: { settings: { sms } } });

beforeAll(async () => {
  const c = await db.center.upsert({ where: { slug: "sms-test" }, update: {}, create: { name: "SMS markaz", slug: "sms-test", smsLogin: "c@x.uz", smsPassword: "pw" } });
  centerId = c.id;
  const f1 = await db.family.create({ data: { centerId, name: "SMS oilasi", guardians: { create: [{ name: "Ota", phone: "998901110001" }, { name: "Ona", phone: "998901110002", isPrimary: true }] } } });
  plainFamily = f1.id;
  const f2 = await db.family.create({ data: { centerId, name: "TG oilasi", guardians: { create: [{ name: "Ota", phone: "998901110003", telegramChatId: "555001" }] } } });
  tgFamily = f2.id;
});

beforeEach(async () => {
  await db.notification.deleteMany({ where: { centerId } });
  await setSms({});
  // park other files' rows: each queue batch here must see only this file's rows
  await db.notification.updateMany({ where: { centerId: { not: centerId }, status: { in: ["PENDING", "SENDING"] } }, data: { status: "PENDING", lockedAt: null, nextAttemptAt: new Date(Date.now() + 365 * 86_400_000) } });
});

describe("notifyFamily + SMS", () => {
  it("a family without Telegram gets one plain-text SMS, to the primary guardian; a re-run adds nothing", async () => {
    expect(await debt(plainFamily, "d1")).toBe(1);
    expect(await debt(plainFamily, "d1")).toBe(0);
    const rows = await db.notification.findMany({ where: { centerId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ channel: "SMS", chatId: "998901110002" });
    expect(rows[0].text).not.toMatch(/[<>⚠]/u);
    expect(rows[0].text).toContain("250 000");
  });
  it("a Telegram family gets Telegram only — unless the center sends SMS to everyone", async () => {
    await debt(tgFamily, "d2");
    expect((await db.notification.findMany({ where: { centerId } })).map((r) => r.channel)).toEqual(["TELEGRAM"]);
    await setSms({ onlyWithoutTelegram: false });
    await debt(tgFamily, "d3");
    expect((await db.notification.findMany({ where: { centerId }, orderBy: { createdAt: "asc" } })).map((r) => r.channel).sort()).toEqual(["SMS", "TELEGRAM", "TELEGRAM"]);
  });
  it("an event switched off, or no Eskiz account, sends no SMS", async () => {
    await setSms({ debt: false });
    expect(await debt(plainFamily, "d4")).toBe(0);
    await setSms({});
    await db.center.update({ where: { id: centerId }, data: { smsPassword: null } });
    expect(await debt(plainFamily, "d5")).toBe(0);
    await db.center.update({ where: { id: centerId }, data: { smsPassword: "pw" } });
  });
});

describe("SMS queue", () => {
  it("the Telegram queue never takes SMS rows; the SMS queue sends them", async () => {
    await debt(plainFamily, "q1");
    await debt(tgFamily, "q2");
    const tg: string[] = [];
    const sms: string[] = [];
    const tgSend: Sender = async (chat) => void tg.push(chat);
    const smsSend: Sender = async (phone, _t, meta) => {
      expect(meta.centerId).toBe(centerId);
      sms.push(phone);
    };
    expect((await processNotifications(tgSend, { gapMs: 0 })).sent).toBe(1);
    expect((await processNotifications(smsSend, { channel: "SMS", gapMs: 0 })).sent).toBe(1);
    expect(tg).toEqual(["555001"]);
    expect(sms).toEqual(["998901110002"]);
  });
  it("dry run logs and marks sent; a removed account fails the row for good", async () => {
    await debt(plainFamily, "q3");
    const logged: string[] = [];
    expect((await processNotifications(smsSender({ dryRun: true, log: (m) => logged.push(String(m)) }), { channel: "SMS", gapMs: 0 })).sent).toBe(1);
    expect(logged[0]).toContain("998901110002");
    await debt(plainFamily, "q4");
    await db.center.update({ where: { id: centerId }, data: { smsLogin: null } });
    const r = await processNotifications(smsSender({ dryRun: true, log: () => {} }), { channel: "SMS", gapMs: 0 });
    expect(r.failed).toBe(1);
    expect((await db.notification.findFirstOrThrow({ where: { centerId, dedupeKey: { startsWith: "q4" } } })).status).toBe("FAILED");
    await db.center.update({ where: { id: centerId }, data: { smsLogin: "c@x.uz" } });
  });
});
