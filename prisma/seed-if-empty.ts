import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

async function main() {
  if (process.env.SEED_DEMO !== "true") {
    console.log("[seed] SEED_DEMO is not true — skipping demo data");
    return;
  }
  const count = await db.center.count();
  if (count > 0) {
    console.log(`[seed] database already has ${count} center(s) — skipping demo data`);
    return;
  }
  const { seedDemo } = await import("./seed-demo");
  await seedDemo(db);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
