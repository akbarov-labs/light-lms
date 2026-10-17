// Creates/resets the lms_test database next to DATABASE_URL, then runs the DB integration tests.
import { execSync } from "node:child_process";
import { createDb } from "../src/lib/db";

async function main() {
  const base = process.env.DATABASE_URL;
  if (!base) throw new Error("DATABASE_URL is not set");
  const url = new URL(base);
  const testDb = `${url.pathname.slice(1) || "lms"}_test`;
  const admin = createDb(base);
  const exists = await admin.$queryRawUnsafe<{ n: number }[]>(`SELECT 1 AS n FROM pg_database WHERE datname = '${testDb}'`);
  if (exists.length === 0) await admin.$executeRawUnsafe(`CREATE DATABASE "${testDb}"`);
  await admin.$disconnect();
  url.pathname = `/${testDb}`;
  const env = { ...process.env, DATABASE_URL: url.toString(), TZ: "Asia/Tashkent" };
  // wipe only the throwaway test database, then apply every migration from scratch
  const test = createDb(url.toString());
  await test.$executeRawUnsafe("DROP SCHEMA IF EXISTS public CASCADE");
  await test.$executeRawUnsafe("CREATE SCHEMA public");
  await test.$disconnect();
  execSync("npx prisma migrate deploy", { stdio: "inherit", env });
  execSync("npx vitest run --config vitest.integration.config.ts", { stdio: "inherit", env });
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
