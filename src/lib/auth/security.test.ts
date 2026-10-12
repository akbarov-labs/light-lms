import { describe, expect, it } from "vitest";
import { checkAuthSecret, clientIp, hashResetCode, newResetCode, newTempPassword, passwordProblem, resetCodeMatches, secureCookies } from "./security";
import { buildCsp, securityHeaders } from "./headers";
import { sessionStale } from "../session";

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
  it("takes the address the nearest proxy appended", () => {
    expect(clientIp(hdrs({ "x-forwarded-for": "10.0.0.1, 203.0.113.9" }))).toBe("203.0.113.9");
    expect(clientIp(hdrs({ "x-real-ip": "198.51.100.2" }))).toBe("198.51.100.2");
    expect(clientIp(hdrs({}))).toBe("unknown");
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
  it("HSTS only over HTTPS", () => {
    expect(securityHeaders(true).map(([k]) => k)).toContain("strict-transport-security");
    expect(securityHeaders(false).map(([k]) => k)).not.toContain("strict-transport-security");
  });
});
