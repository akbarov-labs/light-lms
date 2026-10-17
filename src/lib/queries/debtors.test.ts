import { describe, expect, it } from "vitest";
import { debtMinimum } from "./debtors";

describe("debtMinimum (L4: debtors ?min=)", () => {
  it("parses like every money input", () => {
    expect(debtMinimum("100 000")).toBe(100_000);
    expect(debtMinimum("1,250,000")).toBe(1_250_000);
    expect(debtMinimum("300 000,00")).toBe(300_000);
    expect(debtMinimum("500000 so'm")).toBe(500_000);
  });

  it("no filter for empty, garbage, fractions and non-positive amounts (no digit stripping)", () => {
    expect(debtMinimum(undefined)).toBe(0);
    expect(debtMinimum("")).toBe(0);
    expect(debtMinimum("abc")).toBe(0);
    expect(debtMinimum("150000,50")).toBe(0); // stripping non-digits made this 15 000 050
    expect(debtMinimum("-5000")).toBe(0);
    expect(debtMinimum("0")).toBe(0);
  });
});
