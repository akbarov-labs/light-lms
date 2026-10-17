import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

// Prisma 6's client loaded .env on import; local tsx runs (seed, scripts, worker:dev) relied on that.
// Next and Docker set the variables themselves, and an existing variable is never overwritten.
if (!process.env.DATABASE_URL) {
  try {
    process.loadEnvFile();
  } catch {
    // no .env file
  }
}

/**
 * A Prisma client on a node-postgres pool (Prisma 7 has no built-in engine). Pool sized like Prisma 6's
 * default (connection_limit = 2×CPU+1 there; pg's 10 here) with Prisma 6's 5 s connect timeout — pg's own
 * default is to wait forever. Nothing connects until the first query (`next build` imports this without a URL).
 */
export function createDb(url = process.env.DATABASE_URL) {
  const adapter = new PrismaPg({ connectionString: url, max: 10, connectionTimeoutMillis: 5_000, idleTimeoutMillis: 300_000 });
  return new PrismaClient({ adapter, log: ["warn", "error"] });
}

type Db = ReturnType<typeof createDb>;
const globalForPrisma = globalThis as unknown as { prisma?: Db };

export const db = globalForPrisma.prisma ?? createDb();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

export type Tx = Omit<Db, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;
