import { describe, expect, it } from "vitest";
import { errText } from "./util";
import { classifySendError, telegramSender } from "./notifications";

describe("errText", () => {
  it("keeps the last non-empty line, capped", () => {
    expect(errText(new Error("Invalid prisma call\n\n  at x\nUnique constraint failed  "))).toBe("Unique constraint failed");
    expect(errText("x".repeat(500), 300)).toHaveLength(300);
    expect(errText(new Error(""))).toBe("error");
  });
});

describe("telegramSender", () => {
  it("passes HTML options and aborts a hung call after the timeout (transient → retried later)", async () => {
    let seen: { other?: unknown; signal?: AbortSignal } = {};
    const api = {
      sendMessage: (_chat: string | number, _text: string, other?: unknown, signal?: AbortSignal) => {
        seen = { other, signal };
        return new Promise<never>((_, reject) => signal?.addEventListener("abort", () => reject(signal.reason)));
      },
    };
    const send = telegramSender(api as never, 20);
    const err = await send("1", "<b>hi</b>", { centerId: "c1" }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeTruthy();
    expect(seen.signal?.aborted).toBe(true);
    expect(seen.other).toMatchObject({ parse_mode: "HTML", link_preview_options: { is_disabled: true } });
    expect(classifySendError(err).kind).toBe("transient");
  });
});
