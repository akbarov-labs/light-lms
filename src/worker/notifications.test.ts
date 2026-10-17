import { describe, expect, it } from "vitest";
import { backoffMs, classifySendError } from "./notifications";

describe("classifySendError", () => {
  it("429 → rate limit with Telegram's retry_after", () => {
    expect(classifySendError({ error_code: 429, description: "Too Many Requests", parameters: { retry_after: 17 } })).toEqual({ kind: "rate", retryAfterS: 17 });
    expect(classifySendError({ error_code: 429 })).toEqual({ kind: "rate", retryAfterS: 5 });
  });
  it("403 and 400 chat not found → the chat is gone", () => {
    expect(classifySendError({ error_code: 403, description: "Forbidden: bot was blocked by the user" }).kind).toBe("gone");
    expect(classifySendError({ error_code: 400, description: "Bad Request: chat not found" }).kind).toBe("gone");
  });
  it("other 400 → permanent; network errors and 5xx → transient", () => {
    expect(classifySendError({ error_code: 400, description: "Bad Request: can't parse entities" }).kind).toBe("permanent");
    expect(classifySendError(new Error("ECONNRESET")).kind).toBe("transient");
    expect(classifySendError({ error_code: 502, description: "Bad Gateway" }).kind).toBe("transient");
    expect(classifySendError(undefined).kind).toBe("transient");
  });
});

describe("backoffMs", () => {
  it("doubles from 30 s and caps at one hour", () => {
    expect([1, 2, 3, 4].map(backoffMs)).toEqual([30_000, 60_000, 120_000, 240_000]);
    expect(backoffMs(20)).toBe(3_600_000);
  });
});
