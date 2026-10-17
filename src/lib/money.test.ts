import { describe, expect, it } from "vitest";
import { needsLargeConfirm, parseMoney, typedMoney } from "./money";

describe("parseMoney", () => {
  const ok: [string, number][] = [
    // plain and grouped (uz/ru with spaces, NBSP and narrow NBSP from Excel; en with commas; de/ru with dots)
    ["1250000", 1_250_000],
    ["1 250 000", 1_250_000],
    ["1 250 000", 1_250_000],
    ["1 250 000", 1_250_000],
    ["1,250,000", 1_250_000],
    ["1.250.000", 1_250_000],
    ["1'250'000", 1_250_000],
    ["1_250_000", 1_250_000],
    ["1,250", 1_250],
    ["100,000", 100_000],
    ["0", 0],
    // decimals only when zero
    ["300 000,00", 300_000],
    ["300 000.00", 300_000],
    ["300000,0", 300_000],
    ["1,250,000.00", 1_250_000],
    ["1.250.000,00", 1_250_000],
    ["1 250 000,00 so'm", 1_250_000],
    ["0,00", 0],
    // negatives (ASCII minus, Unicode minus, en dash) and currency suffixes
    ["-300000", -300_000],
    ["−300 000", -300_000],
    ["– 300 000,00", -300_000],
    ["-300 000,00", -300_000],
    ["-1.250.000", -1_250_000],
    ["+50 000", 50_000],
    ["50 000 so'm", 50_000],
    ["50 000 сум", 50_000],
    ["50000 UZS", 50_000],
    ["  75 000  ", 75_000],
  ];
  it.each(ok)("%j → %d", (input, want) => {
    expect(parseMoney(input)).toBe(want);
  });

  const bad: string[] = [
    "150000,50", // tiyin are not money here
    "300 000,05",
    "1,25",
    "1.5",
    "12,34,567", // Indian grouping
    "1 25 000",
    "1 2500",
    "1250 000",
    "1,250.000", // mixed grouping
    "1.250.000.00", // decimal with the grouping character is ambiguous
    "1,250,00", // last group must have three digits — looks like cents on a grouped number
    "abc",
    "",
    "-",
    ",00",
    "1e6",
    "12-000",
    "1,,250",
    "1234567890123456", // 16 digits
  ];
  it.each(bad)("%j → null", (input) => {
    expect(parseMoney(input)).toBeNull();
  });

  it("numbers: integers pass, fractions are rejected", () => {
    expect(parseMoney(300_000)).toBe(300_000);
    expect(parseMoney(-5)).toBe(-5);
    expect(parseMoney(1.5)).toBeNull();
    expect(parseMoney(Number.NaN)).toBeNull();
    expect(parseMoney(null)).toBeNull();
    expect(parseMoney(undefined)).toBeNull();
  });

  it("the ×100 bug is gone: a cashier typing kopecks never gets a hundred times the amount", () => {
    expect(parseMoney("300 000,00")).toBe(300_000);
    expect(parseMoney("-300 000,00")).toBe(-300_000);
  });
});

describe("large payment guard", () => {
  it("above 50 000 000 a payment needs the explicit confirmation", () => {
    expect(needsLargeConfirm(50_000_000, false)).toBe(false);
    expect(needsLargeConfirm(50_000_001, false)).toBe(true);
    expect(needsLargeConfirm(50_000_001, true)).toBe(false);
  });
});

describe("typedMoney (live input)", () => {
  it("groups while typing and keeps a decimal tail separate", () => {
    expect(typedMoney("1250000")).toEqual({ display: "1 250 000", value: 1_250_000 });
    expect(typedMoney("300 000,")).toEqual({ display: "300 000,", value: 300_000 });
    expect(typedMoney("300 000,0")).toEqual({ display: "300 000,0", value: 300_000 });
    expect(typedMoney("300 000,00")).toEqual({ display: "300 000,00", value: 300_000 });
    expect(typedMoney("150 000,5")).toEqual({ display: "150 000,5", value: null });
    expect(typedMoney("")).toEqual({ display: "", value: null });
  });
  it("pasted grouped amounts keep their value", () => {
    expect(typedMoney("1,250,000").value).toBe(1_250_000);
    expect(typedMoney("1.250.000").value).toBe(1_250_000);
    // typing "1,250" in steps: "1," → "1,2" (not clean yet) → "1,250"
    expect(typedMoney("1,").value).toBe(1);
    expect(typedMoney("1,2").value).toBeNull();
    expect(typedMoney("1,250").value).toBe(1_250);
  });
});
