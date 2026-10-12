// First login on an empty production database: creates a center, its first branch and the owner.
// The owner gets a temporary password (printed once) and must change it after signing in.
//   docker compose -f docker-compose.prod.yml run --rm migrate npx tsx scripts/create-owner.ts \
//     --center "Ziyo O'quv Markazi" --slug ziyo --name "Sardor Akbarov" --phone 901234567
import bcrypt from "bcryptjs";
import { db } from "../src/lib/db";
import { normalizePhone } from "../src/lib/phone";
import { PERMS } from "../src/lib/perms";
import { newTempPassword } from "../src/lib/auth/security";
import { BCRYPT_ROUNDS } from "../src/lib/auth/password";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i > 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const centerName = arg("center");
  const slug = arg("slug")?.toLowerCase();
  const ownerName = arg("name");
  const phone = normalizePhone(arg("phone") ?? "");
  const branchName = arg("branch") ?? "Asosiy filial";
  if (!centerName || !slug || !ownerName || !phone || !/^[a-z0-9-]{2,40}$/.test(slug)) {
    console.error('usage: tsx scripts/create-owner.ts --center "Name" --slug name --name "Owner Name" --phone 901234567 [--branch "Branch"]');
    process.exit(1);
  }
  if (await db.center.findUnique({ where: { slug } })) throw new Error(`center slug "${slug}" is taken`);
  if (await db.user.findUnique({ where: { phone } })) throw new Error(`phone ${phone} already has an account`);
  const temp = newTempPassword();
  await db.$transaction(async (tx) => {
    const center = await tx.center.create({ data: { name: centerName, slug } });
    const branch = await tx.branch.create({ data: { centerId: center.id, name: branchName } });
    const owner = await tx.user.create({
      data: { centerId: center.id, name: ownerName, phone, role: "OWNER", perms: [...PERMS], passwordHash: await bcrypt.hash(temp, BCRYPT_ROUNDS), mustChangePassword: true },
    });
    await tx.userBranch.create({ data: { userId: owner.id, branchId: branch.id } });
    await tx.auditLog.create({ data: { centerId: center.id, entity: "Center", entityId: center.id, action: "create", after: { by: "create-owner script", owner: owner.id } } });
  });
  console.log(`Center "${centerName}" created. Owner login: ${phone}  temporary password: ${temp}`);
  console.log("The owner must set a new password at first login.");
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
