import { describe, expect, it } from "vitest";
import { formatPhone, normalizePhone } from "./phone";

describe("normalizePhone", () => {
  it.each([
    ["+998 90 123 45 67", "998901234567"],
    ["998901234567", "998901234567"],
    ["90 123-45-67", "998901234567"],
    ["(90) 1234567", "998901234567"],
    ["00998901234567", "998901234567"],
    ["8901234567", "998901234567"],
  ])("%s → %s", (input, out) => expect(normalizePhone(input)).toBe(out));

  it.each(["", "12345", "79001234567", "99890123456"])("rejects %s", (input) => {
    expect(normalizePhone(input)).toBeNull();
  });

  it("formats", () => expect(formatPhone("998901234567")).toBe("+998 90 123 45 67"));
});
