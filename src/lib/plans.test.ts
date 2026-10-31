import { describe, expect, it } from "vitest";
import { canActivate, isPlan, planFor, planLimit, PLANS, planUsage, seatsLeft } from "./plans";

describe("plan limits", () => {
  it("matches the published tiers", () => {
    expect(planLimit("FREE")).toBe(50);
    expect(planLimit("START")).toBe(150);
    expect(planLimit("GROWTH")).toBe(400);
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
    expect(planFor(50)).toBe("FREE");
    expect(planFor(51)).toBe("START");
    expect(planFor(400)).toBe("GROWTH");
    expect(planFor(401)).toBe("PRO");
    expect(planFor(1001)).toBeNull();
  });
});

describe("canActivate", () => {
  it("allows up to and including the limit", () => {
    expect(canActivate("FREE", 48, false)).toBe(true);
    expect(canActivate("FREE", 49, false)).toBe(true); // becomes the 50th
    expect(canActivate("FREE", 50, false)).toBe(false);
    expect(canActivate("START", 150, false)).toBe(false);
    expect(canActivate("START", 149, false)).toBe(true);
  });

  it("never blocks a student who is already active (second group, transfer)", () => {
    expect(canActivate("FREE", 50, true)).toBe(true);
    expect(canActivate("FREE", 65, true)).toBe(true);
  });

  it("blocks new students when a center is already over (downgraded plan)", () => {
    expect(canActivate("FREE", 80, false)).toBe(false);
  });
});

describe("planUsage", () => {
  it("is ok well below the limit", () => {
    expect(planUsage("FREE", 10)).toEqual({ plan: "FREE", limit: 50, used: 10, remaining: 40, percent: 20, level: "ok" });
  });

  it("warns from 90% of the limit", () => {
    expect(planUsage("FREE", 44).level).toBe("ok");
    expect(planUsage("FREE", 45).level).toBe("near");
    expect(planUsage("START", 135).level).toBe("near");
    expect(planUsage("START", 134).level).toBe("ok");
  });

  it("is full at the limit and over above it, percent capped at 100", () => {
    expect(planUsage("FREE", 50)).toMatchObject({ level: "full", remaining: 0, percent: 100 });
    expect(planUsage("FREE", 65)).toMatchObject({ level: "over", remaining: 0, percent: 100 });
  });

  it("handles an empty center", () => {
    expect(planUsage("PRO", 0)).toMatchObject({ level: "ok", percent: 0, remaining: 1000 });
  });
});

describe("seatsLeft (imports)", () => {
  it("counts free seats and never goes negative", () => {
    expect(seatsLeft("FREE", 45)).toBe(5);
    expect(seatsLeft("FREE", 50)).toBe(0);
    expect(seatsLeft("FREE", 60)).toBe(0);
  });
});
