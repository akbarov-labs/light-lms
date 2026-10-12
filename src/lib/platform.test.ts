import { describe, expect, it } from "vitest";
import { isPlatformAdmin, platformAdminPhones } from "./platform";

describe("platform admins", () => {
  it("normalizes the env list", () => {
    expect([...platformAdminPhones("+998 90 123 45 67, 901234568 ,bad")]).toEqual(["998901234567", "998901234568"]);
  });
  it("matches only listed phones, nobody when unset", () => {
    expect(isPlatformAdmin("998901234567", "998901234567")).toBe(true);
    expect(isPlatformAdmin("998901234569", "998901234567")).toBe(false);
    expect(isPlatformAdmin("998901234567", "")).toBe(false);
    expect(isPlatformAdmin(null, "998901234567")).toBe(false);
  });
});
