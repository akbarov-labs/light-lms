// Roles + permission switches — HANDOFF §4 / decision 8.
export const PERMS = [
  "finance.view",
  "payments.take",
  "payments.refund",
  "archive",
  "export",
  "leads",
  "students.edit",
  "groups.edit",
  "staff.manage",
  "settings",
  "discounts",
] as const;

export type Perm = (typeof PERMS)[number];
export type RoleName = "OWNER" | "MANAGER" | "ADMIN" | "TEACHER";

export const DEFAULT_PERMS: Record<RoleName, Perm[]> = {
  OWNER: [...PERMS],
  MANAGER: PERMS.filter((p) => p !== "settings"),
  ADMIN: ["payments.take", "leads", "students.edit", "groups.edit", "export"],
  TEACHER: [],
};

/** Effective permissions: OWNER always has everything; MANAGER can never get center settings. */
export function effectivePerms(role: RoleName, stored: string[]): Set<Perm> {
  if (role === "OWNER") return new Set(PERMS);
  const valid = stored.filter((p): p is Perm => (PERMS as readonly string[]).includes(p));
  const set = new Set(valid);
  if (role === "MANAGER") set.delete("settings");
  if (role === "TEACHER") return new Set();
  return set;
}

/** Owners see every branch; everyone else only the branches they are assigned to. */
export function allowedBranches(role: RoleName, assigned: string[]): string[] | null {
  return role === "OWNER" ? null : assigned;
}
