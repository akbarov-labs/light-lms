// Public demo server only (DEMO_MODE=true): every night the whole database goes back to a fresh demo center,
// dated to today, so visitors always land in a realistic, clean month. Never runs anywhere else.
import { db } from "@/lib/db";
import { demoMode } from "@/config/brand";
import type { JobResult } from "./jobs";

export async function resetDemo(): Promise<JobResult> {
  if (!demoMode()) return { skipped: "DEMO_MODE is off" };
  // Safety net against DEMO_MODE set on a real server by mistake: on a demo server every center except the
  // demo one is a visitor's same-day signup. A center older than two days means real data — refuse to wipe.
  const old = await db.center.count({ where: { slug: { not: "demo" }, createdAt: { lt: new Date(Date.now() - 2 * 86_400_000) } } });
  if (old > 0) throw new Error(`refusing to reset: ${old} non-demo center(s) older than 2 days — is DEMO_MODE set on a real server?`);
  const tables = await db.$queryRaw<{ tablename: string }[]>`
    SELECT tablename FROM pg_tables WHERE schemaname = current_schema() AND tablename <> '_prisma_migrations'`;
  if (tables.length) {
    const list = tables.map((t) => `"${t.tablename.replaceAll('"', '""')}"`).join(", ");
    await db.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  }
  const { seedDemo } = await import("../../prisma/seed-demo");
  await seedDemo(db);
  return { tables: tables.length };
}
