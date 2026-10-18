import { describe, expect, it } from "vitest";
import { htmlToSms, smsParts } from "./text";
import { EskizClient, SmsError } from "./eskiz";
import { msg } from "@/lib/messages";
import { readSettings } from "@/lib/settings";

describe("htmlToSms", () => {
  it("drops tags, emoji and decodes entities", () => {
    const html = msg.debt("uz", { center: "A & B \"Til\"", debt: 300000, payUrl: "https://x.uz/pay/f1" });
    expect(html).toContain("<b>");
    const sms = htmlToSms(html);
    expect(sms).not.toMatch(/[<>⚠]/u);
    expect(sms.startsWith('A & B "Til"')).toBe(true); // entities decoded back
    expect(sms).toContain("https://x.uz/pay/f1");
    expect(htmlToSms("&lt;b&gt; &amp;amp;")).toBe("<b> &amp;");
  });
  it("keeps line breaks but no empty runs", () => {
    expect(htmlToSms("✅ <b>X</b>\n\n\n  y  \n")).toBe("X\n\ny");
  });
});

describe("smsParts", () => {
  it("GSM 160 / 153, Cyrillic 70 / 67", () => {
    expect(smsParts("a".repeat(160))).toBe(1);
    expect(smsParts("a".repeat(161))).toBe(2);
    expect(smsParts("я".repeat(70))).toBe(1);
    expect(smsParts("я".repeat(71))).toBe(2);
  });
});

describe("SMS settings", () => {
  it("defaults: reminders, debts and trials on, the frequent ones off", () => {
    expect(readSettings({}).sms).toEqual({ payment: false, reminder: true, debt: true, absence: false, trial: true, reportCard: false, examResult: false, onlyWithoutTelegram: true });
  });
  it("a broken sms block falls back without touching the rest", () => {
    const s = readSettings({ trialLessons: 3, sms: "nope" });
    expect(s.trialLessons).toBe(3);
    expect(s.sms.debt).toBe(true);
  });
});

type Call = { url: string; auth?: string; body: Record<string, string> };
function fakeFetch(script: ((c: Call) => Response)[]) {
  const calls: Call[] = [];
  const f = (async (url: string, init: RequestInit) => {
    const body = Object.fromEntries([...(init.body as FormData).entries()].map(([k, v]) => [k, String(v)]));
    const c = { url, auth: (init.headers as Record<string, string> | undefined)?.authorization, body };
    calls.push(c);
    const next = script.shift();
    if (!next) throw new Error("unexpected call");
    return next(c);
  }) as unknown as typeof fetch;
  return { f, calls };
}
const json = (status: number, b: unknown) => new Response(JSON.stringify(b), { status, headers: { "content-type": "application/json" } });
const acct = { login: "c@x.uz", password: "secret", from: null };

describe("EskizClient", () => {
  it("logs in once, sends with the bearer token and the default sender 4546", async () => {
    const { f, calls } = fakeFetch([() => json(200, { data: { token: "T1" } }), () => json(200, { id: "r1", status: "waiting" }), () => json(200, { id: "r2" })]);
    const c = new EskizClient(f);
    expect(await c.send(acct, "998901234567", "Salom")).toEqual({ id: "r1" });
    await c.send(acct, "998901234568", "Salom 2");
    expect(calls.map((x) => x.url.replace("https://notify.eskiz.uz/api", ""))).toEqual(["/auth/login", "/message/sms/send", "/message/sms/send"]);
    expect(calls[0].body).toEqual({ email: "c@x.uz", password: "secret" });
    expect(calls[1]).toMatchObject({ auth: "Bearer T1", body: { mobile_phone: "998901234567", message: "Salom", from: "4546" } });
  });
  it("an expired token (401) logs in again once", async () => {
    const { f, calls } = fakeFetch([() => json(200, { data: { token: "T1" } }), () => json(401, {}), () => json(200, { data: { token: "T2" } }), () => json(200, { id: "r" })]);
    await new EskizClient(f).send({ ...acct, from: "MARKAZ" }, "998901234567", "x");
    expect(calls[3]).toMatchObject({ auth: "Bearer T2", body: { from: "MARKAZ" } });
  });
  it("classifies failures: bad login / rejected text = permanent, 5xx and network = transient", async () => {
    const kind = async (script: ((c: Call) => Response)[]) => {
      const e = await new EskizClient(fakeFetch(script).f).send(acct, "998901234567", "x").catch((x: unknown) => x);
      return e instanceof SmsError ? e.kind : "other";
    };
    expect(await kind([() => json(401, { message: "bad" })])).toBe("permanent");
    expect(await kind([() => json(200, { data: { token: "T" } }), () => json(422, { message: "template" })])).toBe("permanent");
    expect(await kind([() => json(200, { data: { token: "T" } }), () => json(502, {})])).toBe("transient");
    expect(await kind([() => json(500, {})])).toBe("transient");
    const offline = (async () => {
      throw new TypeError("fetch failed");
    }) as unknown as typeof fetch;
    const e = await new EskizClient(offline).send(acct, "998901234567", "x").catch((x: unknown) => x);
    expect(e).toBeInstanceOf(SmsError);
    expect((e as SmsError).kind).toBe("transient");
  });
});
