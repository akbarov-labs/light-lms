import { describe, expect, it } from "vitest";
import { canActivate, isPlan, planFor, planLimit, PLANS, planUsage, seatsLeft } from "./plans";

describe("plan limits", () => {
  it("matches the published tiers", () => {
    expect(planLimit("FREE")).toBe(30);
    expect(planLimit("START")).toBe(100);
    expect(planLimit("GROWTH")).toBe(300);
    expect(planLimit("PRO")).toBe(1000);
    expect(PLANS.FREE.monthlyPrice).toBe(0);
  });

  it("recognises plan names", () => {
    expect(isPlan("GROWTH")).toBe(true);
    expect(isPlan("growth")).toBe(false);
    expect(isPlan(undefined)).toBe(false);
  });

  it("picks the smallest plan that fits", () => {
    expect(planFor(0)).toBe("FREE");
    expect(planFor(30)).toBe("FREE");
    expect(planFor(31)).toBe("START");
    expect(planFor(300)).toBe("GROWTH");
    expect(planFor(301)).toBe("PRO");
    expect(planFor(1001)).toBeNull();
  });
});

describe("canActivate", () => {
  it("allows up to and including the limit", () => {
    expect(canActivate("FREE", 28, false)).toBe(true);
    expect(canActivate("FREE", 29, false)).toBe(true); // becomes the 30th
    expect(canActivate("FREE", 30, false)).toBe(false);
    expect(canActivate("START", 100, false)).toBe(false);
    expect(canActivate("START", 99, false)).toBe(true);
  });

  it("never blocks a student who is already active (second group, transfer)", () => {
    expect(canActivate("FREE", 30, true)).toBe(true);
    expect(canActivate("FREE", 45, true)).toBe(true);
  });

  it("blocks new students when a center is already over (downgraded plan)", () => {
    expect(canActivate("FREE", 60, false)).toBe(false);
  });
});

describe("planUsage", () => {
  it("is ok well below the limit", () => {
    expect(planUsage("FREE", 10)).toEqual({ plan: "FREE", limit: 30, used: 10, remaining: 20, percent: 33, level: "ok" });
  });

  it("warns from 90% of the limit", () => {
    expect(planUsage("FREE", 26).level).toBe("ok");
    expect(planUsage("FREE", 27).level).toBe("near");
    expect(planUsage("START", 90).level).toBe("near");
    expect(planUsage("START", 89).level).toBe("ok");
  });

  it("is full at the limit and over above it, percent capped at 100", () => {
    expect(planUsage("FREE", 30)).toMatchObject({ level: "full", remaining: 0, percent: 100 });
    expect(planUsage("FREE", 45)).toMatchObject({ level: "over", remaining: 0, percent: 100 });
  });

  it("handles an empty center", () => {
    expect(planUsage("PRO", 0)).toMatchObject({ level: "ok", percent: 0, remaining: 1000 });
  });
});

describe("seatsLeft (imports)", () => {
  it("counts free seats and never goes negative", () => {
    expect(seatsLeft("FREE", 25)).toBe(5);
    expect(seatsLeft("FREE", 30)).toBe(0);
    expect(seatsLeft("FREE", 40)).toBe(0);
  });
});
