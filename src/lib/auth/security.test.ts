import { describe, expect, it } from "vitest";
import { checkAuthSecret, clientIp, hashResetCode, newResetCode, newTempPassword, passwordProblem, resetCodeMatches, secureCookies } from "./security";
import { buildCsp, securityHeaders, TELEGRAM_FRAME_ANCESTORS } from "./headers";
import { sessionStale } from "../session";
import { assertStrongAuthSecret, authSecretVerdict } from "./startup";

const hdrs = (o: Record<string, string>) => ({ get: (k: string) => o[k.toLowerCase()] ?? null });

describe("checkAuthSecret", () => {
  it("rejects missing, short, example and repetitive secrets", () => {
    expect(checkAuthSecret(undefined).ok).toBe(false);
    expect(checkAuthSecret("short-secret").ok).toBe(false);
    expect(checkAuthSecret("dev-only-secret-change-me-0123456789abcdef").ok).toBe(false);
    expect(checkAuthSecret("change-me-to-a-long-random-string").ok).toBe(false);
    expect(checkAuthSecret("a".repeat(64)).ok).toBe(false);
  });
  it("accepts an openssl-style random secret", () => {
    expect(checkAuthSecret("q3Zl8m1VbH2xYt9KcR0pW4sJ7nF6dE5uA+gL/oQiT2M=").ok).toBe(true);
  });
});

describe("clientIp", () => {
  it("behind a trusted proxy takes the address the nearest proxy appended", () => {
    const trustProxy = true;
    expect(clientIp(hdrs({ "x-forwarded-for": "10.0.0.1, 203.0.113.9" }), { trustProxy })).toBe("203.0.113.9");
    expect(clientIp(hdrs({ "x-real-ip": "198.51.100.2" }), { trustProxy })).toBe("198.51.100.2");
    expect(clientIp(hdrs({}), { trustProxy })).toBe("direct");
  });
  it("without TRUST_PROXY ignores forwarding headers (spoofable): peer or one shared bucket", () => {
    const trustProxy = false;
    expect(clientIp(hdrs({ "x-forwarded-for": "203.0.113.9" }), { trustProxy })).toBe("direct");
    expect(clientIp(hdrs({ "x-real-ip": "198.51.100.2" }), { trustProxy })).toBe("direct");
    expect(clientIp(hdrs({ "x-forwarded-for": "203.0.113.9" }), { trustProxy, peer: "192.0.2.7" })).toBe("192.0.2.7");
  });
  it("reads TRUST_PROXY from the environment", () => {
    const prev = process.env.TRUST_PROXY;
    process.env.TRUST_PROXY = "true";
    expect(clientIp(hdrs({ "x-forwarded-for": "203.0.113.9" }))).toBe("203.0.113.9");
    process.env.TRUST_PROXY = "false";
    expect(clientIp(hdrs({ "x-forwarded-for": "203.0.113.9" }))).toBe("direct");
    if (prev === undefined) delete process.env.TRUST_PROXY;
    else process.env.TRUST_PROXY = prev;
  });
});

describe("authSecretVerdict (startup)", () => {
  const DEV = "dev-only-secret-change-me-0123456789abcdef";
  const GOOD = "q3Zl8m1VbH2xYt9KcR0pW4sJ7nF6dE5uA+gL/oQiT2M=";
  it("a good secret always starts", () => {
    expect(authSecretVerdict(GOOD, "https://crm.example.uz").action).toBe("ok");
    expect(authSecretVerdict(GOOD, "http://192.168.1.20:3000").action).toBe("ok");
  });
  it("the dev fallback / example / missing secret is refused off localhost, even on http", () => {
    expect(authSecretVerdict(DEV, "http://192.168.1.20:3000").action).toBe("refuse");
    expect(authSecretVerdict("change-me-to-a-long-random-string", "http://crm.example.uz").action).toBe("refuse");
    expect(authSecretVerdict(undefined, "http://10.0.0.5").action).toBe("refuse");
    expect(authSecretVerdict(DEV, "https://crm.example.uz").action).toBe("refuse");
  });
  it("only warns on a local http install", () => {
    expect(authSecretVerdict(DEV, "http://localhost:3000").action).toBe("warn");
    expect(authSecretVerdict(DEV, "http://127.0.0.1:3010").action).toBe("warn");
    expect(authSecretVerdict(DEV, "http://[::1]:3000").action).toBe("warn");
    expect(authSecretVerdict(DEV, undefined).action).toBe("warn");
  });
  it("a short but private secret warns on http, is refused on https", () => {
    expect(authSecretVerdict("Zx81kQ0pLm", "http://192.168.1.20:3000").action).toBe("warn");
    expect(authSecretVerdict("Zx81kQ0pLm", "https://crm.example.uz").action).toBe("refuse");
  });
  it("assertStrongAuthSecret throws on refuse", () => {
    const prev = { s: process.env.AUTH_SECRET, u: process.env.APP_URL };
    process.env.AUTH_SECRET = DEV;
    process.env.APP_URL = "http://192.168.1.20:3000";
    const err = console.error;
    console.error = () => {};
    try {
      expect(() => assertStrongAuthSecret("test")).toThrow(/Refusing to start/);
    } finally {
      console.error = err;
      for (const [k, v] of [["AUTH_SECRET", prev.s], ["APP_URL", prev.u]] as const) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    }
  });
});

describe("secureCookies", () => {
  it("is on behind an https proxy even when APP_URL is http", () => {
    const prev = process.env.APP_URL;
    process.env.APP_URL = "http://localhost:3010";
    expect(secureCookies(hdrs({}))).toBe(false);
    expect(secureCookies(hdrs({ "x-forwarded-proto": "https" }))).toBe(true);
    process.env.APP_URL = "https://crm.example.uz";
    expect(secureCookies(hdrs({}))).toBe(true);
    process.env.APP_URL = prev;
  });
});

describe("reset codes", () => {
  it("are 6 digits, stored as an HMAC bound to the user", () => {
    const code = newResetCode();
    expect(code).toMatch(/^\d{6}$/);
    const h = hashResetCode("u1", code, "s".repeat(40));
    expect(resetCodeMatches("u1", code, h, "s".repeat(40))).toBe(true);
    expect(resetCodeMatches("u2", code, h, "s".repeat(40))).toBe(false);
    expect(resetCodeMatches("u1", code, h, "t".repeat(40))).toBe(false);
    expect(resetCodeMatches("u1", "000000" === code ? "000001" : "000000", h, "s".repeat(40))).toBe(false);
  });
  it("temporary passwords avoid look-alike characters", () => {
    for (let i = 0; i < 50; i++) expect(newTempPassword()).toMatch(/^[a-hjkmnp-z2-9]{10}$/);
  });
});

describe("passwordProblem", () => {
  it("needs 8+ characters, some variety, not the phone", () => {
    expect(passwordProblem("abc12")).toBe("short");
    expect(passwordProblem("aaaaaaaa")).toBe("weak");
    expect(passwordProblem("12345678")).toBe("weak");
    expect(passwordProblem("901234567", "998901234567")).toBe("weak");
    expect(passwordProblem("olma-daraxt-7")).toBeNull();
  });
});

describe("sessionStale", () => {
  it("rejects sessions issued before the last password change", () => {
    const changed = new Date("2026-10-12T08:00:00.700Z");
    const sec = Math.floor(changed.getTime() / 1000);
    expect(sessionStale(sec - 60, changed)).toBe(true);
    expect(sessionStale(sec, changed)).toBe(false); // the login right after the change
    expect(sessionStale(undefined, changed)).toBe(true);
    expect(sessionStale(sec - 60, null)).toBe(false);
  });
});

describe("security headers", () => {
  it("CSP uses the nonce, forbids framing and limits form targets to Payme", () => {
    const csp = buildCsp("abc", { dev: false, https: true });
    expect(csp).toContain("script-src 'self' 'nonce-abc' 'strict-dynamic'");
    expect(csp).not.toContain("unsafe-eval");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("form-action 'self' https://checkout.paycom.uz");
    expect(csp).toContain("upgrade-insecure-requests");
    expect(buildCsp("abc", { dev: true, https: false })).toContain("'unsafe-eval'");
    expect(buildCsp("abc", { dev: false, https: false })).not.toContain("upgrade-insecure-requests");
  });
  it("every pay provider's checkout is an allowed form target (redirects after submit are checked too)", () => {
    const formAction = buildCsp("abc", { dev: false, https: true }).split("; ").find((d) => d.startsWith("form-action"))!;
    for (const host of ["https://checkout.paycom.uz", "https://checkout.test.paycom.uz", "https://my.click.uz", "https://www.uzumbank.uz"]) expect(formAction).toContain(host);
  });
  it("only the Mini App may be framed, and only by Telegram Web", () => {
    expect(buildCsp("abc", { dev: false, https: true, frameAncestors: TELEGRAM_FRAME_ANCESTORS })).toContain("frame-ancestors https://web.telegram.org");
    expect(securityHeaders(true, { embeddable: true }).map(([k]) => k)).not.toContain("x-frame-options");
    expect(securityHeaders(true)).toContainEqual(["x-frame-options", "DENY"]);
  });
  it("HSTS only over HTTPS", () => {
    expect(securityHeaders(true).map(([k]) => k)).toContain("strict-transport-security");
    expect(securityHeaders(false).map(([k]) => k)).not.toContain("strict-transport-security");
  });
});
