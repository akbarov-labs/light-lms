import { describe, expect, it } from "vitest";
import { allowedBranches, DEFAULT_PERMS, effectivePerms } from "./perms";

describe("permissions", () => {
  it("owner has everything, regardless of stored switches", () => {
    expect(effectivePerms("OWNER", []).has("settings")).toBe(true);
    expect(effectivePerms("OWNER", []).size).toBe(11);
  });
  it("discounts are the owner's and the manager's by default, not an admin's", () => {
    expect(effectivePerms("OWNER", []).has("discounts")).toBe(true);
    expect(DEFAULT_PERMS.MANAGER).toContain("discounts");
    expect(DEFAULT_PERMS.ADMIN).not.toContain("discounts");
  });
  it("manager never gets center settings", () => {
    expect(effectivePerms("MANAGER", ["settings", "finance.view"]).has("settings")).toBe(false);
    expect(effectivePerms("MANAGER", DEFAULT_PERMS.MANAGER).has("payments.refund")).toBe(true);
  });
  it("admin defaults exclude refunds, finance and archive", () => {
    const p = effectivePerms("ADMIN", DEFAULT_PERMS.ADMIN);
    expect(p.has("payments.take")).toBe(true);
    expect(p.has("payments.refund")).toBe(false);
    expect(p.has("finance.view")).toBe(false);
    expect(p.has("archive")).toBe(false);
  });
  it("teachers get no switches", () => {
    expect(effectivePerms("TEACHER", ["finance.view"]).size).toBe(0);
  });
  it("ignores unknown switches", () => {
    expect(effectivePerms("ADMIN", ["root"]).size).toBe(0);
  });
  it("branch scoping", () => {
    expect(allowedBranches("OWNER", ["b1"])).toBeNull();
    expect(allowedBranches("ADMIN", ["b1"])).toEqual(["b1"]);
  });
});
