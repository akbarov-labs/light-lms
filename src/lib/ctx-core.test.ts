import { describe, expect, it } from "vitest";
import { DEFAULT_PERMS, PERMS, type Perm } from "./perms";
import { staffPermsFor } from "./ctx-core";

const actor = (role: "OWNER" | "MANAGER" | "ADMIN", perms: Perm[]) => ({ role, can: (p: Perm) => role === "OWNER" || perms.includes(p) });

describe("staffPermsFor (S2: grant only what you hold)", () => {
  const manager = actor("MANAGER", ["payments.take", "leads", "students.edit", "groups.edit", "staff.manage"]);

  it("a manager without export creating an ADMIN with the role defaults gets no export", () => {
    const perms = staffPermsFor(manager, "ADMIN", null);
    expect(perms).not.toContain("export");
    expect(perms.sort()).toEqual(["groups.edit", "leads", "payments.take", "students.edit"]);
  });

  it("ticked boxes the actor does not hold are dropped too", () => {
    expect(staffPermsFor(manager, "ADMIN", ["export", "payments.refund", "leads"])).toEqual(["leads"]);
  });

  it("MANAGER defaults are filtered the same way", () => {
    const perms = staffPermsFor(manager, "MANAGER", null);
    for (const p of perms) expect(manager.can(p)).toBe(true);
    expect(perms).not.toContain("finance.view");
  });

  it("switches the actor cannot see stay as they were on edit", () => {
    expect(staffPermsFor(manager, "ADMIN", ["leads"], ["export", "students.edit"]).sort()).toEqual(["export", "leads"]);
    expect(staffPermsFor(manager, "ADMIN", [], ["payments.refund"])).toEqual(["payments.refund"]);
  });

  it("an owner may grant anything; OWNER/TEACHER roles are fixed", () => {
    const owner = actor("OWNER", []);
    expect(staffPermsFor(owner, "ADMIN", null).sort()).toEqual([...DEFAULT_PERMS.ADMIN].sort());
    expect(staffPermsFor(owner, "OWNER", [])).toEqual([...PERMS]);
    expect(staffPermsFor(manager, "TEACHER", ["leads"])).toEqual([]);
  });
});
