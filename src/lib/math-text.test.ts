import { describe, expect, it } from "vitest";
import { hasMath, splitMath } from "./math-text";

describe("splitMath", () => {
  it("separates formulas from words", () => {
    expect(splitMath("$2^{100}$ ning oxirgi raqamini toping.")).toEqual([
      { math: true, s: "2^{100}" },
      { math: false, s: " ning oxirgi raqamini toping." },
    ]);
    expect(splitMath("Hisoblang: $\\frac{3}{4}+\\frac{1}{2}$")).toEqual([
      { math: false, s: "Hisoblang: " },
      { math: true, s: "\\frac{3}{4}+\\frac{1}{2}" },
    ]);
  });

  it("keeps plain text plain: no formula, an escaped or unclosed dollar, an empty pair", () => {
    expect(splitMath("[4; 8] kesmada nechta son bor?")).toEqual([{ math: false, s: "[4; 8] kesmada nechta son bor?" }]);
    expect(splitMath("narxi 5\\$")).toEqual([{ math: false, s: "narxi 5$" }]);
    expect(splitMath("a $ b")).toEqual([{ math: false, s: "a $ b" }]);
    expect(splitMath("a $$ b")).toEqual([{ math: false, s: "a $$ b" }]);
    expect(hasMath("12 va 15")).toBe(false);
    expect(hasMath("$x^2$")).toBe(true);
  });
});
