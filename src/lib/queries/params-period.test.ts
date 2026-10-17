import { describe, expect, it } from "vitest";
import { enumParam, groupCodeParam, groupStatusWhere, pageParam, strParam } from "./params";
import { zonedDayStart, zonedRange } from "./period";
import { PAYMENT_METHODS } from "./payments";

describe("query params (B14)", () => {
  it("accepts known enum values and ignores the rest", () => {
    expect(enumParam(PAYMENT_METHODS, "CASH")).toBe("CASH");
    expect(enumParam(PAYMENT_METHODS, "BOGUS")).toBeUndefined();
    expect(enumParam(PAYMENT_METHODS, ["CASH"])).toBeUndefined();
    expect(enumParam(PAYMENT_METHODS, undefined)).toBeUndefined();
  });

  it("page numbers: junk → 1", () => {
    for (const v of [undefined, "", "abc", "0", "-3", "1.01", "1e9"]) expect(pageParam(v), String(v)).toBe(1);
    expect(pageParam("7")).toBe(7);
    expect(pageParam(["3", "4"])).toBe(3);
  });

  it("strings, group status and group codes", () => {
    expect(strParam("  x ")).toBe("x");
    expect(strParam(["a", "b"])).toBe("a");
    expect(strParam("   ")).toBeUndefined();
    expect(groupStatusWhere("all")).toEqual({});
    expect(groupStatusWhere("FINISHED")).toEqual({ status: "FINISHED" });
    expect(groupStatusWhere("NOPE")).toEqual({ status: { in: ["ACTIVE", "PLANNED"] } });
    expect(groupCodeParam("42")).toBe(42);
    expect(groupCodeParam("99999999999")).toBeUndefined();
    expect(groupCodeParam("4a")).toBeUndefined();
  });
});

describe("center-timezone day boundaries (B13)", () => {
  it("Tashkent midnight is 19:00 UTC the day before", () => {
    expect(zonedDayStart("2026-11-01").toISOString()).toBe("2026-10-31T19:00:00.000Z");
    const nov = zonedRange("2026-11-01", "2026-11-30");
    expect(nov).toEqual({ gte: new Date("2026-10-31T19:00:00.000Z"), lt: new Date("2026-11-30T19:00:00.000Z") });
    const t = new Date("2026-10-31T20:00:00Z");
    expect(t >= nov.gte && t < nov.lt).toBe(true);
  });

  it("works for a zone with daylight saving too", () => {
    expect(zonedDayStart("2026-07-01", "Europe/Berlin").toISOString()).toBe("2026-06-30T22:00:00.000Z");
    expect(zonedDayStart("2026-01-01", "Europe/Berlin").toISOString()).toBe("2025-12-31T23:00:00.000Z");
  });
});
