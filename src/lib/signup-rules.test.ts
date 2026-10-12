import { describe, expect, it } from "vitest";
import { looksLikeBot, slugify, uniqueSlug } from "./signup-rules";
import { attemptKey, checkAttempts, MemoryAttemptStore, RULES } from "./auth/ratelimit";

const now = new Date("2026-10-12T10:00:00Z");

describe("signup rate limits (shared attempt store)", () => {
  const ip = "1.2.3.4";
  const at = (min: number) => new Date(now.getTime() - min * 60_000);
  const checks = [
    { key: attemptKey.signupIp(ip), rule: RULES.signupIp },
    { key: attemptKey.signupCreatedIp(ip), rule: RULES.signupCreatedIp },
  ];

  it("allows five attempts in 15 minutes, refuses the sixth until the oldest expires", async () => {
    const store = new MemoryAttemptStore();
    for (const m of [10, 4, 3, 2, 1]) await store.record(attemptKey.signupIp(ip), false, at(m));
    const v = await checkAttempts(store, checks, now);
    expect(v.allowed).toBe(false);
    expect(v.retryAfterMs).toBe(5 * 60_000);
    expect((await checkAttempts(store, checks, new Date(now.getTime() + 5 * 60_000 + 1))).allowed).toBe(true);
  });

  it("caps created centers per IP per day", async () => {
    const store = new MemoryAttemptStore();
    for (const m of [600, 120, 60]) await store.record(attemptKey.signupCreatedIp(ip), false, at(m));
    const v = await checkAttempts(store, checks, now);
    expect(v.allowed).toBe(false);
    expect(v.retryAfterMs).toBe((24 * 60 - 600) * 60_000);
    // another address is not affected
    expect((await checkAttempts(store, [{ key: attemptKey.signupCreatedIp("5.6.7.8"), rule: RULES.signupCreatedIp }], now)).allowed).toBe(true);
  });
});

describe("looksLikeBot", () => {
  const started = (msAgo: number) => String(now.getTime() - msAgo);
  it("passes a human", () => {
    expect(looksLikeBot({ honeypot: "", startedAt: started(20_000) }, now)).toBe(false);
  });
  it("catches a filled honeypot", () => {
    expect(looksLikeBot({ honeypot: "http://spam", startedAt: started(20_000) }, now)).toBe(true);
  });
  it("catches instant, missing, forged or stale timestamps", () => {
    expect(looksLikeBot({ honeypot: "", startedAt: started(500) }, now)).toBe(true);
    expect(looksLikeBot({ honeypot: "", startedAt: null }, now)).toBe(true);
    expect(looksLikeBot({ honeypot: "", startedAt: "abc" }, now)).toBe(true);
    expect(looksLikeBot({ honeypot: "", startedAt: started(-60_000) }, now)).toBe(true);
    expect(looksLikeBot({ honeypot: "", startedAt: started(2 * 24 * 3600_000) }, now)).toBe(true);
  });
});

describe("slugify", () => {
  it("makes latin slugs from Uzbek and Russian names", () => {
    expect(slugify("Cambridge Learning Centre")).toBe("cambridge-learning-centre");
    expect(slugify("Ilm Ziyo O'quv Markazi")).toBe("ilm-ziyo-oquv-markazi");
    expect(slugify("Школа Знаний №1")).toBe("shkola-znaniy-1");
    expect(slugify("Qo‘qon IT")).toBe("qoqon-it");
  });
  it("falls back when nothing usable is left and trims long names", () => {
    expect(slugify("!!!")).toBe("markaz");
    expect(slugify("a")).toBe("markaz");
    expect(slugify("x".repeat(80)).length).toBeLessThanOrEqual(32);
  });
});

describe("uniqueSlug", () => {
  it("adds the first free suffix", () => {
    expect(uniqueSlug("demo", [])).toBe("demo");
    expect(uniqueSlug("demo", ["demo"])).toBe("demo-2");
    expect(uniqueSlug("demo", ["demo", "demo-2", "demo-3"])).toBe("demo-4");
  });
});
