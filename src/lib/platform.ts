// Platform (super) admins: only users whose `platformAdmin` flag is set in the database.
// The flag is set by the server operator with `scripts/platform-admin.ts` — never by a form or action,
// so nobody can become platform admin by signing up or by being created with some phone number.
import { db } from "./db";
import { normalizePhone } from "./phone";
import { audit } from "./audit";

export function isPlatformAdmin(user: { platformAdmin?: boolean | null; archivedAt?: Date | null } | null | undefined): boolean {
  return !!user && user.platformAdmin === true && !user.archivedAt;
}

/** Operator only (server shell): grant or revoke the flag by phone. Audited in the user's center journal. */
export async function setPlatformAdmin(phoneInput: string, grant: boolean): Promise<{ name: string; phone: string; changed: boolean }> {
  const phone = normalizePhone(phoneInput);
  if (!phone) throw new Error(`invalid phone "${phoneInput}"`);
  return db.$transaction(async (tx) => {
    const user = await tx.user.findUnique({ where: { phone } });
    if (!user) throw new Error(`no staff account with phone ${phone}`);
    if (grant && user.archivedAt) throw new Error(`${phone} is archived`);
    if (user.platformAdmin === grant) return { name: user.name, phone, changed: false };
    await tx.user.update({ where: { id: user.id }, data: { platformAdmin: grant } });
    await audit(tx, {
      centerId: user.centerId,
      entity: "User",
      entityId: user.id,
      action: grant ? "platform.grant" : "platform.revoke",
      before: { platformAdmin: user.platformAdmin },
      after: { platformAdmin: grant, by: "platform-admin script" },
    });
    return { name: user.name, phone, changed: true };
  });
}
