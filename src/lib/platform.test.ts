import { describe, expect, it } from "vitest";
import { isPlatformAdmin } from "./platform";

describe("platform admins", () => {
  it("is the database flag only", () => {
    expect(isPlatformAdmin({ platformAdmin: true })).toBe(true);
    expect(isPlatformAdmin({ platformAdmin: false })).toBe(false);
    expect(isPlatformAdmin({})).toBe(false);
    expect(isPlatformAdmin(null)).toBe(false);
  });
  it("an archived account loses it", () => {
    expect(isPlatformAdmin({ platformAdmin: true, archivedAt: new Date() })).toBe(false);
  });
});
