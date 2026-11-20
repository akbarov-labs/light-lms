import { describe, expect, it } from "vitest";
import { DeliveryError, backoffMs, classifySendError, richRefused, routedSender, telegramSender } from "./notifications";

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

describe("richRefused", () => {
  it("400 (not chat-not-found) and 404 → send the plain text instead", () => {
    expect(richRefused({ error_code: 400, description: "Bad Request: can't parse rich message" })).toBe(true);
    expect(richRefused({ error_code: 404, description: "Not Found: method not found" })).toBe(true);
  });
  it("429, 403, chat not found, 5xx and network errors keep the queue's normal handling", () => {
    expect(richRefused({ error_code: 429, parameters: { retry_after: 3 } })).toBe(false);
    expect(richRefused({ error_code: 403, description: "Forbidden: bot was blocked by the user" })).toBe(false);
    expect(richRefused({ error_code: 400, description: "Bad Request: chat not found" })).toBe(false);
    expect(richRefused({ error_code: 502 })).toBe(false);
    expect(richRefused(new Error("ECONNRESET"))).toBe(false);
    expect(richRefused(undefined)).toBe(false);
  });
});

describe("telegramSender with rich messages", () => {
  const tgError = (error_code: number, description: string) => Object.assign(new Error(description), { error_code, description });
  function fakeApi(richResult: () => Promise<unknown> = async () => ({})) {
    const calls: { method: string; args: unknown[] }[] = [];
    return {
      calls,
      api: {
        sendMessage: async (...args: unknown[]) => void calls.push({ method: "sendMessage", args }),
        sendRichMessage: async (...args: unknown[]) => {
          calls.push({ method: "sendRichMessage", args });
          return richResult();
        },
      },
    };
  }
  const quiet = { log: () => {} };

  it("flag on + a rich form → sendRichMessage with the html, no plain message", async () => {
    const f = fakeApi();
    await telegramSender(f.api as never, 1000, { rich: true, ...quiet })("42", "<b>plain</b>", { centerId: "c", rich: "<h3>rich</h3>" });
    expect(f.calls.map((c) => c.method)).toEqual(["sendRichMessage"]);
    expect(f.calls[0].args.slice(0, 2)).toEqual(["42", { html: "<h3>rich</h3>" }]);
  });
  it("flag off → the plain text even when the row has a rich form", async () => {
    const f = fakeApi();
    await telegramSender(f.api as never, 1000, { rich: false, ...quiet })("42", "<b>plain</b>", { centerId: "c", rich: "<h3>rich</h3>" });
    expect(f.calls.map((c) => c.method)).toEqual(["sendMessage"]);
    expect(f.calls[0].args.slice(0, 2)).toEqual(["42", "<b>plain</b>"]);
  });
  it("flag on, row without a rich form → plain text", async () => {
    const f = fakeApi();
    await telegramSender(f.api as never, 1000, { rich: true, ...quiet })("42", "<b>plain</b>", { centerId: "c", rich: null });
    expect(f.calls.map((c) => c.method)).toEqual(["sendMessage"]);
  });
  it("Telegram refuses the rich form (400) → the plain text goes out in the same attempt, and it is logged", async () => {
    const f = fakeApi(async () => {
      throw tgError(400, "Bad Request: unsupported rich tag");
    });
    const logged: string[] = [];
    await telegramSender(f.api as never, 1000, { rich: true, log: (m) => logged.push(m) })("42", "<b>plain</b>", { centerId: "c", rich: "<x>" });
    expect(f.calls.map((c) => c.method)).toEqual(["sendRichMessage", "sendMessage"]);
    expect(f.calls[1].args[1]).toBe("<b>plain</b>");
    expect(logged[0]).toContain("unsupported rich tag");
  });
  it("rate limit, blocked chat or a network error on the rich send → thrown to the queue, no plain duplicate", async () => {
    for (const err of [Object.assign(tgError(429, "Too Many Requests"), { parameters: { retry_after: 7 } }), tgError(403, "Forbidden: bot was blocked by the user"), new Error("ETIMEDOUT")]) {
      const f = fakeApi(async () => {
        throw err;
      });
      const thrown = await telegramSender(f.api as never, 1000, { rich: true, ...quiet })("42", "p", { centerId: "c", rich: "<h3>r</h3>" }).then(
        () => null,
        (e: unknown) => e,
      );
      expect(thrown).toBe(err);
      expect(f.calls.map((c) => c.method)).toEqual(["sendRichMessage"]);
    }
  });
});

describe("telegramSender with date_time entities", () => {
  const tgError = (error_code: number, description: string) => Object.assign(new Error(description), { error_code, description });
  it("a refused <tg-time> (400) is sent again without the entity, inner text kept", async () => {
    const texts: string[] = [];
    const api = {
      sendMessage: async (_c: string, text: string) => {
        texts.push(text);
        if (text.includes("<tg-time")) throw tgError(400, "Bad Request: can't parse entities: unsupported start tag \"tg-time\"");
      },
      sendRichMessage: async () => ({}),
    };
    await telegramSender(api as never, 1000, { rich: false, log: () => {} })("1", 'Dars: <tg-time unix="1" format="dt">17.11.2026 14:00</tg-time>', { centerId: "c" });
    expect(texts).toEqual(['Dars: <tg-time unix="1" format="dt">17.11.2026 14:00</tg-time>', "Dars: 17.11.2026 14:00"]);
  });
  it("a 400 on a message without <tg-time> stays a permanent error (no second try), as before", async () => {
    let n = 0;
    const err = tgError(400, "Bad Request: message is too long");
    const api = { sendMessage: async () => { n++; throw err; }, sendRichMessage: async () => ({}) };
    await expect(telegramSender(api as never, 1000, { rich: false })("1", "plain", { centerId: "c" })).rejects.toBe(err);
    expect(n).toBe(1);
  });
});

describe("telegramSender with a Mini App button", () => {
  function api() {
    const calls: { method: string; args: unknown[] }[] = [];
    return { calls, api: { sendMessage: async (...args: unknown[]) => void calls.push({ method: "sendMessage", args }), sendRichMessage: async (...args: unknown[]) => void calls.push({ method: "sendRichMessage", args }) } };
  }
  const button = { text: "📝 Testni boshlash", path: "/tg/quiz?q=abc" };

  it("adds a web_app button for this bot's Mini App, as plain HTML even with a rich form", async () => {
    const f = api();
    await telegramSender(f.api as never, 1000, { rich: true, appBase: "https://sabaq.uz", botId: "777", log: () => {} })("1", "Test", { centerId: "c", rich: "<h3>r</h3>", button });
    expect(f.calls.map((c) => c.method)).toEqual(["sendMessage"]);
    expect((f.calls[0].args[2] as { reply_markup: unknown }).reply_markup).toEqual({ inline_keyboard: [[{ text: button.text, web_app: { url: "https://sabaq.uz/tg/quiz?q=abc&b=777" } }]] });
  });

  it("sends without a button when the app is not on HTTPS or the stored button is not one", async () => {
    const f = api();
    await telegramSender(f.api as never, 1000, { rich: false, appBase: "http://localhost:3000" })("1", "Test", { centerId: "c", button });
    await telegramSender(f.api as never, 1000, { rich: false, appBase: "https://sabaq.uz" })("1", "Test", { centerId: "c", button: { text: "x", path: "https://evil.example" } });
    expect(f.calls.every((c) => !(c.args[2] as { reply_markup?: unknown }).reply_markup)).toBe(true);
  });
});

describe("routedSender (managed bots)", () => {
  const tg = (error_code: number, description: string) => Object.assign(new Error(description), { error_code, description });
  function setup(o: { route?: string | null; centerFails?: unknown; sharedFails?: unknown; reachable?: boolean; tokenFails?: boolean } = {}) {
    const log: string[] = [];
    const sent: string[] = [];
    const blocked: string[] = [];
    const router = {
      route: async () => o.route ?? null,
      sender: async (botId: string) => {
        if (o.tokenFails) throw tg(400, "Bad Request: bot not found");
        return async (chatId: string) => {
          if (o.centerFails) throw o.centerFails;
          sent.push(`${botId}:${chatId}`);
        };
      },
      blocked: async (botId: string, chatId: string) => void blocked.push(`${botId}:${chatId}`),
      reachable: async () => o.reachable ?? false,
    };
    const shared = async (chatId: string) => {
      if (o.sharedFails) throw o.sharedFails;
      sent.push(`shared:${chatId}`);
    };
    return { send: routedSender(shared, router, (m) => log.push(m)), sent, blocked, log };
  }
  const meta = { centerId: "c1" };

  it("no center bot for this chat → the shared bot, nothing returned", async () => {
    const s = setup();
    expect(await s.send("5", "hi", meta)).toBeUndefined();
    expect(s.sent).toEqual(["shared:5"]);
  });
  it("the center bot delivers and its id is returned (Notification.sentVia)", async () => {
    const s = setup({ route: "777" });
    expect(await s.send("5", "hi", meta)).toBe("777");
    expect(s.sent).toEqual(["777:5"]);
  });
  it("403 from the center bot → marked blocked, the shared bot sends in the same attempt", async () => {
    const s = setup({ route: "777", centerFails: tg(403, "Forbidden: bot was blocked by the user") });
    expect(await s.send("5", "hi", meta)).toBeUndefined();
    expect(s.blocked).toEqual(["777:5"]);
    expect(s.sent).toEqual(["shared:5"]);
  });
  it("other center bot errors are not hidden behind the shared bot (the queue retries)", async () => {
    const s = setup({ route: "777", centerFails: tg(429, "Too Many Requests") });
    await expect(s.send("5", "hi", meta)).rejects.toMatchObject({ error_code: 429 });
    expect(s.sent).toEqual([]);
  });
  it("token not available → the shared bot", async () => {
    const s = setup({ route: "777", tokenFails: true });
    await s.send("5", "hi", meta);
    expect(s.sent).toEqual(["shared:5"]);
  });
  it("403 from the shared bot while a center bot still reaches the person → permanent, not 'gone' (no unlink)", async () => {
    const s = setup({ sharedFails: tg(403, "Forbidden: bot can't initiate conversation with a user"), reachable: true });
    const e = await s.send("5", "hi", meta).catch((x) => x);
    expect(e).toBeInstanceOf(DeliveryError);
    expect(classifySendError(e).kind).toBe("permanent");
  });
  it("403 from the shared bot and no center bot → 'gone' as before", async () => {
    const s = setup({ sharedFails: tg(403, "Forbidden: bot was blocked by the user"), reachable: false });
    expect(classifySendError(await s.send("5", "hi", meta).catch((x) => x)).kind).toBe("gone");
  });
});
