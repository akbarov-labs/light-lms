import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { alertOps, resetOpsAlerts } from "./ops-alert";

const env = { ...process.env };
beforeEach(() => {
  resetOpsAlerts();
  process.env.TELEGRAM_BOT_TOKEN = "123:abc";
  process.env.OPS_TELEGRAM_CHAT_ID = "42";
  vi.stubGlobal("fetch", vi.fn(async () => new Response("{}", { status: 200 })));
});
afterEach(() => {
  vi.unstubAllGlobals();
  for (const k of ["TELEGRAM_BOT_TOKEN", "OPS_TELEGRAM_CHAT_ID"]) {
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
});

describe("ops alerts", () => {
  it("are off without a bot token and chat id", async () => {
    delete process.env.OPS_TELEGRAM_CHAT_ID;
    expect(await alertOps("x", "boom")).toBe(false);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("send once, then stay quiet for 10 minutes per key", async () => {
    const t = 1_000_000;
    expect(await alertOps("job:nightly", "failed", t)).toBe(true);
    expect(await alertOps("job:nightly", "failed again", t + 60_000)).toBe(false);
    expect(await alertOps("job:reminders", "failed", t + 60_000)).toBe(true);
    expect(await alertOps("job:nightly", "still failing", t + 11 * 60_000)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(3);
    const body = JSON.parse((vi.mocked(fetch).mock.calls[0][1] as RequestInit).body as string);
    expect(body.chat_id).toBe("42");
    expect(body.text).toContain("failed");
  });

  it("never throws when Telegram is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("offline"); }));
    expect(await alertOps("x", "boom")).toBe(false);
  });
});
