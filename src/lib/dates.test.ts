import { describe, expect, it } from "vitest";
import { addMonthsAnchored, clampedDate, formatDate, monthRange, todayISO, weekdayOf } from "./dates";

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
});
