// Server operator: make a staff account a platform (super) admin, or take it away.
//   docker compose -f docker-compose.prod.yml run --rm migrate npx tsx scripts/platform-admin.ts grant 901234567
//   docker compose -f docker-compose.prod.yml run --rm migrate npx tsx scripts/platform-admin.ts revoke 901234567
// Platform admins see /platform (every center, plans, disable a center). The change is audited.
import { db } from "../src/lib/db";
import { setPlatformAdmin } from "../src/lib/platform";

async function main() {
  const [cmd, phone] = process.argv.slice(2);
  if ((cmd !== "grant" && cmd !== "revoke") || !phone) {
    console.error("usage: tsx scripts/platform-admin.ts grant|revoke <phone>");
    process.exit(1);
  }
  const r = await setPlatformAdmin(phone, cmd === "grant");
  const state = cmd === "grant" ? "is now a platform admin" : "is no longer a platform admin";
  console.log(`${r.name} (${r.phone}) ${state}${r.changed ? "" : " (no change)"}`);
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
