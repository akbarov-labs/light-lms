import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { botGone, forgetManagedBotToken, managedBotToken, setBotApiTransport, TelegramApiError } from "./api";
import { scopedCenterId, withBotScope } from "./scope";
import { suggestedUsername } from "./service";

describe("suggestedUsername", () => {
  it("ends in _bot, keeps letters and digits, 32 characters at most", () => {
    expect(suggestedUsername("ilm-markazi")).toBe("ilm_markazi_bot");
    expect(suggestedUsername("a")).toBe("a_center_bot");
    expect(suggestedUsername("123-school")).toBe("c123_school_bot");
    const long = suggestedUsername("a".repeat(60));
    expect(long.length).toBeLessThanOrEqual(32);
    expect(long.endsWith("_bot")).toBe(true);
    expect(suggestedUsername("--")).toBe("center_bot");
  });
});

describe("botGone", () => {
  it("400/401/403/404 are final, network/5xx/429 are not", () => {
    for (const c of [400, 401, 403, 404]) expect(botGone(new TelegramApiError(c, "x"))).toBe(true);
    for (const c of [429, 500, 502]) expect(botGone(new TelegramApiError(c, "x"))).toBe(false);
    expect(botGone(new Error("ECONNRESET"))).toBe(false);
  });
});

describe("managedBotToken", () => {
  let calls: { token: string; method: string; params: Record<string, unknown> }[] = [];
  const saved = process.env.TELEGRAM_BOT_TOKEN;
  beforeEach(() => {
    process.env.TELEGRAM_BOT_TOKEN = "1:manager";
    calls = [];
    setBotApiTransport(async (token, method, params) => {
      calls.push({ token, method, params });
      return `${params.user_id}:token${calls.length}`;
    });
  });
  afterEach(() => {
    setBotApiTransport(null);
    process.env.TELEGRAM_BOT_TOKEN = saved;
  });

  it("asks the manager bot with the managed bot's id and caches for 10 minutes", async () => {
    expect(await managedBotToken("42", { now: 0 })).toBe("42:token1");
    expect(calls[0]).toEqual({ token: "1:manager", method: "getManagedBotToken", params: { user_id: 42 } });
    expect(await managedBotToken("42", { now: 9 * 60_000 })).toBe("42:token1");
    expect(await managedBotToken("42", { now: 11 * 60_000 })).toBe("42:token2");
  });
  it("fresh and forget skip the cache", async () => {
    await managedBotToken("7", { now: 0 });
    expect(await managedBotToken("7", { fresh: true, now: 1 })).toBe("7:token2");
    forgetManagedBotToken("7");
    expect(await managedBotToken("7", { now: 2 })).toBe("7:token3");
  });
  it("no shared bot → no managed bot tokens", async () => {
    process.env.TELEGRAM_BOT_TOKEN = "";
    await expect(managedBotToken("9")).rejects.toThrow(/TELEGRAM_BOT_TOKEN/);
  });
});

describe("bot scope", () => {
  it("is the center inside withBotScope, across awaits, and null outside or for the shared bot", async () => {
    expect(scopedCenterId()).toBeNull();
    await withBotScope({ centerId: "c1", botId: "b1" }, async () => {
      await new Promise((r) => setTimeout(r, 1));
      expect(scopedCenterId()).toBe("c1");
      await withBotScope(null, async () => expect(scopedCenterId()).toBeNull());
      expect(scopedCenterId()).toBe("c1");
    });
    await withBotScope(null, async () => expect(scopedCenterId()).toBeNull());
    expect(scopedCenterId()).toBeNull();
  });
});
