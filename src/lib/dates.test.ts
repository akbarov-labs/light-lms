import { describe, expect, it } from "vitest";
import { addMonthsAnchored, clampedDate, formatDate, isISODate, isMonth, monthParam, monthRange, todayISO, weekdayOf } from "./dates";

describe("dates", () => {
  it("weekday is ISO (Mon=1, Sun=7)", () => {
    expect(weekdayOf("2026-10-12")).toBe(1);
    expect(weekdayOf("2026-10-11")).toBe(7);
  });
  it("clamps day 31 to month end", () => {
    expect(clampedDate(2026, 2, 31)).toBe("2026-02-28");
    expect(clampedDate(2028, 2, 30)).toBe("2028-02-29");
    expect(addMonthsAnchored("2026-01-31", 1, 31)).toBe("2026-02-28");
    expect(addMonthsAnchored("2026-02-28", 1, 31)).toBe("2026-03-31");
    expect(clampedDate(2026, 13, 5)).toBe("2027-01-05");
    expect(clampedDate(2026, 0, 5)).toBe("2025-12-05");
  });
  it("month range", () => expect(monthRange("2026-02")).toEqual({ start: "2026-02-01", end: "2026-02-28" }));
  it("today in Tashkent crosses midnight before UTC", () => {
    expect(todayISO(new Date("2026-10-11T19:30:00Z"))).toBe("2026-10-12");
  });
  it("formats", () => expect(formatDate("2026-10-05")).toBe("05.10.2026"));

  it("isISODate refuses impossible dates instead of rolling them over", () => {
    for (const ok of ["2026-02-28", "2028-02-29", "2026-12-31", "2026-01-01"]) expect(isISODate(ok), ok).toBe(true);
    for (const bad of ["2026-02-31", "2026-02-29", "2026-13-01", "2026-00-10", "2026-04-31", "2026-10-00", "2026-1-01", "2026-10-01T00:00", "", null, 20261001]) expect(isISODate(bad), String(bad)).toBe(false);
  });
  it("month parameter: YYYY-MM with MM 01–12 and a sane year; anything else is the current month", () => {
    for (const ok of ["2026-01", "2026-12", "2000-06", "2100-12"]) expect(isMonth(ok), ok).toBe(true);
    for (const bad of ["2026-13", "2026-00", "2026-1", "1999-12", "2101-01", "0000-01", "2026-10-01", "", undefined, ["2026-10"]]) expect(isMonth(bad), String(bad)).toBe(false);
    const now = new Date("2026-10-17T08:00:00Z");
    expect(monthParam("2026-13", now)).toBe("2026-10");
    expect(monthParam("2026-00", now)).toBe("2026-10");
    expect(monthParam(undefined, now)).toBe("2026-10");
    expect(monthParam("2026-03", now)).toBe("2026-03");
  });
});
