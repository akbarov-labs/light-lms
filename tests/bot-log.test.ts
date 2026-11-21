// The conversation log behind /conversations: listing per chat, one conversation in order, another center
// sees nothing, and the 90-day cleanup. (The agent and tutor tests check that their turns are logged.)
// Run: npm run test:integration
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { conversation, listConversations, logBotMessages, plainText, pruneBotLog } from "@/lib/services/bot-log";

let centerId = "";
let otherId = "";
const now = new Date("2026-11-20T10:00:00Z");
const daysAgo = (d: number) => new Date(now.getTime() - d * 86_400_000);

beforeAll(async () => {
  centerId = (await db.center.create({ data: { name: "Suhbat markazi", slug: "bot-log-test" } })).id;
  otherId = (await db.center.create({ data: { name: "Boshqa", slug: "bot-log-other" } })).id;
  await logBotMessages(centerId, "501", "AGENT", [{ from: "PERSON", text: "Narxi qancha?", name: "Ona" }, { from: "BOT", text: "350 000 so'm." }], daysAgo(2));
  await logBotMessages(centerId, "502", "TUTOR", [{ from: "PERSON", text: "2x=8", name: "Ali" }, { from: "BOT", text: "x = ?" }], daysAgo(1));
  await logBotMessages(centerId, "501", "AGENT", [{ from: "STAFF", text: "Ertaga keling", name: "Ega" }], daysAgo(0.5));
  await logBotMessages(centerId, "503", "AGENT", [{ from: "PERSON", text: "eski", name: "Eski" }], daysAgo(120));
  await logBotMessages(otherId, "501", "AGENT", [{ from: "PERSON", text: "boshqa markaz", name: "X" }], daysAgo(1));
});

describe("conversation log", () => {
  it("lists one row per chat and bot, newest first, with the person's name and the last message", async () => {
    const rows = await listConversations(centerId);
    expect(rows.map((r) => [r.chatId, r.kind, r.name, r.messages, r.lastFrom, r.lastText])).toEqual([
      ["501", "AGENT", "Ona", 3, "STAFF", "Ertaga keling"],
      ["502", "TUTOR", "Ali", 2, "BOT", "x = ?"],
      ["503", "AGENT", "Eski", 1, "PERSON", "eski"],
    ]);
    expect((await listConversations(centerId, { kind: "TUTOR" })).map((r) => r.chatId)).toEqual(["502"]);
  });

  it("shows one conversation in order; another center sees only its own", async () => {
    expect((await conversation(centerId, "501", "AGENT")).map((m) => m.text)).toEqual(["Narxi qancha?", "350 000 so'm.", "Ertaga keling"]);
    expect((await conversation(otherId, "501", "AGENT")).map((m) => m.text)).toEqual(["boshqa markaz"]);
    expect(await conversation(otherId, "502", "TUTOR")).toEqual([]);
  });

  it("drops empty texts, and the reply as the person read it (no Telegram HTML)", async () => {
    await logBotMessages(centerId, "504", "TUTOR", [{ from: "PERSON", text: "  " }, { from: "BOT", text: plainText("<b>3</b> &lt; 5 &amp; <a href=\"x\">bu</a>") }], now);
    expect((await conversation(centerId, "504", "TUTOR")).map((m) => m.text)).toEqual(["3 < 5 & bu"]);
  });

  it("deletes what is older than 90 days, nothing newer", async () => {
    expect(await pruneBotLog(now)).toBe(1);
    expect(await conversation(centerId, "503", "AGENT")).toEqual([]);
    expect((await conversation(centerId, "501", "AGENT")).length).toBe(3);
  });
});
