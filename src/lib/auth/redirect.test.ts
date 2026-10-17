import { describe, expect, it } from "vitest";
import { safeNextPath } from "./redirect";

describe("safeNextPath (S5: login ?next=)", () => {
  it("keeps same-site paths with their query", () => {
    expect(safeNextPath("/students?x=1")).toBe("/students?x=1");
    expect(safeNextPath("/groups/abc#top")).toBe("/groups/abc#top");
    expect(safeNextPath("/")).toBe("/");
  });

  it("refuses anything that could leave the site", () => {
    expect(safeNextPath("/\t/evil.com")).toBeNull();
    expect(safeNextPath("//evil.com")).toBeNull();
    expect(safeNextPath("/\\evil.com")).toBeNull();
    expect(safeNextPath("/\n/evil.com")).toBeNull();
    expect(safeNextPath("/\x00x")).toBeNull();
    expect(safeNextPath("https://evil.com")).toBeNull();
    expect(safeNextPath("evil.com")).toBeNull();
    expect(safeNextPath("")).toBeNull();
    expect(safeNextPath(null)).toBeNull();
  });
});
