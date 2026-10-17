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

export const DEFAULT_POOL_MAX = 20;
export const DEFAULT_POOL_TIMEOUT_MS = 15_000;

const positiveInt = (v: string | undefined, fallback: number, max: number) => {
  const n = Number(v?.trim());
  return v?.trim() && Number.isInteger(n) && n > 0 ? Math.min(n, max) : fallback;
};

/**
 * Pool settings from the environment. DB_POOL_MAX = connections per process (web 20 by default; compose gives
 * the worker WORKER_DB_POOL_MAX, 10). DB_POOL_TIMEOUT_MS = how long a query waits for a free connection (or a
 * new one to open) before failing — pg's own default is forever, so a burst would hang requests instead of
 * erroring. Garbage values fall back to the defaults.
 */
export function poolOptions(env: Record<string, string | undefined> = process.env): { max: number; connectionTimeoutMillis: number } {
  return {
    max: positiveInt(env.DB_POOL_MAX, DEFAULT_POOL_MAX, 500),
    connectionTimeoutMillis: positiveInt(env.DB_POOL_TIMEOUT_MS, DEFAULT_POOL_TIMEOUT_MS, 600_000),
  };
}

/**
 * A Prisma client on a node-postgres pool (Prisma 7 has no built-in engine), sized by `poolOptions()`.
 * Nothing connects until the first query (`next build` imports this without a URL).
 */
export function createDb(url = process.env.DATABASE_URL) {
  const adapter = new PrismaPg({ connectionString: url, ...poolOptions(), idleTimeoutMillis: 300_000 });
  return new PrismaClient({ adapter, log: ["warn", "error"] });
}

type Db = ReturnType<typeof createDb>;
const globalForPrisma = globalThis as unknown as { prisma?: Db };

export const db = globalForPrisma.prisma ?? createDb();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;

export type Tx = Omit<Db, "$connect" | "$disconnect" | "$on" | "$transaction" | "$extends">;
