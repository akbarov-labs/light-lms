// Server operator's last resort (e.g. the only owner lost their password and has no Telegram link):
//   docker compose -f docker-compose.prod.yml run --rm migrate npx tsx scripts/reset-password.ts 901234567
// Prints a temporary password; the user must change it after signing in. Clears a login lockout too.
import { db } from "../src/lib/db";
import { normalizePhone } from "../src/lib/phone";
import { newTempPassword } from "../src/lib/auth/security";
import { setPassword } from "../src/lib/auth/password";
import { audit } from "../src/lib/audit";

async function main() {
  const phone = normalizePhone(process.argv[2] ?? "");
  if (!phone) {
    console.error("usage: tsx scripts/reset-password.ts <phone>");
    process.exit(1);
  }
  const user = await db.user.findUnique({ where: { phone } });
  if (!user) throw new Error(`no staff account with phone ${phone}`);
  const temp = newTempPassword();
  await db.$transaction(async (tx) => {
    await setPassword(tx, user, temp, { mustChange: true });
    await audit(tx, { centerId: user.centerId, entity: "User", entityId: user.id, action: "password.reset", after: { by: "server script" } });
  });
  console.log(`${user.name} (${phone}${user.archivedAt ? ", ARCHIVED" : ""}): temporary password ${temp}`);
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
