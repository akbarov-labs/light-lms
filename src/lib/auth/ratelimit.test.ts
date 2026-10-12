import { describe, expect, it } from "vitest";
import { attemptKey, checkAttempts, MemoryAttemptStore, recordAttempt, retryAfterMs, retryMinutes, RULES, type Rule } from "./ratelimit";

const MIN = 60_000;
const at = (m: number) => new Date(Date.UTC(2026, 9, 12, 8, 0) + m * MIN);
const rule: Rule = { limit: 5, windowMs: 15 * MIN, resetOnSuccess: true };

describe("retryAfterMs", () => {
  it("allows while under the limit", () => {
    expect(retryAfterMs([at(0), at(1), at(2), at(3)], rule, at(4))).toBe(0);
  });
  it("blocks at the limit until the oldest failure leaves the window", () => {
    const f = [at(0), at(1), at(2), at(3), at(4)];
    expect(retryAfterMs(f, rule, at(5))).toBe(10 * MIN);
    expect(retryAfterMs(f, rule, at(14))).toBe(1 * MIN);
    expect(retryAfterMs(f, rule, at(15))).toBe(0);
  });
  it("ignores failures outside the window and unsorted input", () => {
    expect(retryAfterMs([at(4), at(-30), at(0), at(-20), at(2)], rule, at(5))).toBe(0);
  });
  it("with more failures than the limit waits for enough of them to expire", () => {
    const f = [at(0), at(1), at(2), at(3), at(4), at(5), at(6)];
    // 7 failures, limit 5: need the 3rd oldest (at 2) to expire → 2 + 15 − 7 = 10 min
    expect(retryAfterMs(f, rule, at(7))).toBe(10 * MIN);
  });
});

describe("checkAttempts + MemoryAttemptStore", () => {
  const phone = attemptKey.loginPhone("998901234567");
  const ip = attemptKey.loginIp("203.0.113.7");
  const checks = [
    { key: ip, rule: RULES.loginIp },
    { key: phone, rule: RULES.loginPhone },
  ];

  it("locks a phone after 5 wrong passwords and unlocks after 15 minutes", async () => {
    const s = new MemoryAttemptStore();
    for (let i = 0; i < 5; i++) {
      expect((await checkAttempts(s, checks, at(i))).allowed).toBe(true);
      await recordAttempt(s, [ip, phone], false, at(i));
    }
    const locked = await checkAttempts(s, checks, at(5));
    expect(locked.allowed).toBe(false);
    expect(retryMinutes(locked.retryAfterMs)).toBe(10);
    expect((await checkAttempts(s, checks, at(15))).allowed).toBe(true);
  });

  it("a successful login clears the phone's failures but not the IP's", async () => {
    const s = new MemoryAttemptStore();
    for (let i = 0; i < 4; i++) await recordAttempt(s, [ip, phone], false, at(i));
    await recordAttempt(s, [ip, phone], true, at(4));
    await recordAttempt(s, [ip, phone], false, at(5));
    expect(await s.failures(phone, at(-10), true)).toHaveLength(1);
    expect(await s.failures(ip, at(-10), false)).toHaveLength(5);
    expect((await checkAttempts(s, checks, at(6))).allowed).toBe(true);
  });

  it("locks an IP that sprays many phones, without locking those phones", async () => {
    const s = new MemoryAttemptStore();
    for (let i = 0; i < RULES.loginIp.limit; i++) {
      const p = attemptKey.loginPhone(`99890${String(i).padStart(7, "0")}`);
      await recordAttempt(s, [ip, p], false, at(i / 10));
    }
    expect((await checkAttempts(s, checks, at(4))).allowed).toBe(false);
    // the same victim phone from another address is fine
    const other = [{ key: attemptKey.loginIp("198.51.100.1"), rule: RULES.loginIp }, { key: phone, rule: RULES.loginPhone }];
    expect((await checkAttempts(s, other, at(4))).allowed).toBe(true);
  });

  it("reports the longest wait when several checks block", async () => {
    const s = new MemoryAttemptStore();
    const a: Rule = { limit: 1, windowMs: 5 * MIN, resetOnSuccess: false };
    const b: Rule = { limit: 1, windowMs: 30 * MIN, resetOnSuccess: false };
    await recordAttempt(s, ["a", "b"], false, at(0));
    const v = await checkAttempts(s, [{ key: "a", rule: a }, { key: "b", rule: b }], at(1));
    expect(v).toEqual({ allowed: false, retryAfterMs: 29 * MIN });
  });

  it("clear() forgets a key", async () => {
    const s = new MemoryAttemptStore();
    for (let i = 0; i < 5; i++) await recordAttempt(s, [phone], false, at(i));
    await s.clear(phone);
    expect((await checkAttempts(s, [{ key: phone, rule: RULES.loginPhone }], at(5))).allowed).toBe(true);
  });
});

describe("retryMinutes", () => {
  it("rounds up and is at least 1", () => {
    expect(retryMinutes(0)).toBe(1);
    expect(retryMinutes(61_000)).toBe(2);
  });
});

describe("public lead form budget", () => {
  it("lets a visitor send 10 leads an hour from one address, then stops", async () => {
    const store = new MemoryAttemptStore();
    const key = attemptKey.leadIp("203.0.113.9");
    const t0 = new Date("2026-10-12T10:00:00Z");
    for (let i = 0; i < 10; i++) {
      expect((await checkAttempts(store, [{ key, rule: RULES.leadIp }], t0)).allowed).toBe(true);
      await recordAttempt(store, [key], false, t0);
    }
    expect((await checkAttempts(store, [{ key, rule: RULES.leadIp }], t0)).allowed).toBe(false);
    expect((await checkAttempts(store, [{ key, rule: RULES.leadIp }], new Date(t0.getTime() + 61 * 60_000))).allowed).toBe(true);
  });
});
