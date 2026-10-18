import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { initDataHash, verifyInitData } from "./telegram-webapp";

const TOKEN = "123456:TEST-token";
const NOW = 1_790_000_000;

function sign(fields: Record<string, string>, token = TOKEN): string {
  const p = new URLSearchParams(fields);
  p.set("hash", initDataHash([...p.entries()], token));
  return p.toString();
}
const user = JSON.stringify({ id: 4242, first_name: "Dilnoza", language_code: "ru" });

describe("Telegram init data", () => {
  it("matches the documented algorithm", () => {
    const check = "auth_date=1\nquery_id=Q\nuser={}";
    const secret = createHmac("sha256", "WebAppData").update(TOKEN).digest();
    expect(initDataHash([["user", "{}"], ["auth_date", "1"], ["query_id", "Q"], ["hash", "x"]], TOKEN)).toBe(createHmac("sha256", secret).update(check).digest("hex"));
  });
  it("accepts fresh, correctly signed data (signature field included in the check)", () => {
    const raw = sign({ query_id: "AAE", user, auth_date: String(NOW - 60), signature: "sig" });
    expect(verifyInitData(raw, TOKEN, NOW)).toEqual({ ok: true, user: { id: 4242, first_name: "Dilnoza", language_code: "ru" }, authDate: NOW - 60 });
  });
  it("refuses another bot's data, tampering, stale data and missing users", () => {
    expect(verifyInitData(sign({ user, auth_date: String(NOW) }, "999:other"), TOKEN, NOW)).toEqual({ ok: false, reason: "hash" });
    const raw = sign({ user, auth_date: String(NOW) });
    expect(verifyInitData(raw.replace("4242", "4243"), TOKEN, NOW).ok).toBe(false);
    expect(verifyInitData(sign({ user, auth_date: String(NOW - 25 * 3600) }), TOKEN, NOW)).toEqual({ ok: false, reason: "expired" });
    expect(verifyInitData(sign({ auth_date: String(NOW) }), TOKEN, NOW)).toEqual({ ok: false, reason: "user" });
    expect(verifyInitData(sign({ user: JSON.stringify({ id: -1 }), auth_date: String(NOW) }), TOKEN, NOW)).toEqual({ ok: false, reason: "user" });
    expect(verifyInitData("", TOKEN, NOW)).toEqual({ ok: false, reason: "missing" });
    expect(verifyInitData("user=x&hash=nothex", TOKEN, NOW)).toEqual({ ok: false, reason: "missing" });
  });
});
