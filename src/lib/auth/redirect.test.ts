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

  it("refuses dot segments and encoded dots/slashes that normalise to //host", () => {
    for (const bad of [
      "/..//evil.com",
      "/x/..//evil.com",
      "/.//evil.com",
      "/%2e%2e//evil.com",
      "/%2E%2E//evil.com",
      "/x/../\\evil.com",
      "/x/%2f%2fevil.com",
      "/x/%5cevil.com",
      "/x/..",
      "/./students",
    ]) {
      expect(safeNextPath(bad), bad).toBeNull();
    }
  });

  it("allows encoded characters and dots in the query string", () => {
    expect(safeNextPath("/students?q=a%2Fb&x=..")).toBe("/students?q=a%2Fb&x=..");
    expect(safeNextPath("/files/report.v2")).toBe("/files/report.v2");
  });
});
