// One run of a job at a time across every worker replica and manual `npm run job:<name>`.
//
// A Postgres advisory lock is held by an open transaction for as long as the job runs
// (pg_try_advisory_xact_lock). Session locks (pg_try_advisory_lock) are not safe with Prisma's connection
// pool: lock and unlock may land on different connections, and a session lock is re-entrant, so two runs in
// one process would both "get" it. The transaction holds one pool connection while the job runs; the job's
// own queries use the others. If the process dies, Postgres drops the connection and the lock with it.
import { db } from "@/lib/db";

/** Jobs that work on the same data share one lock (billing and lessons are steps of nightly; demo reset re-runs nightly). */
const SHARED: Record<string, string> = { lessons: "nightly", billing: "nightly", "demo-reset": "nightly" };

export const lockKeyFor = (job: string): string => SHARED[job] ?? job;

export type Locked<T> = { ran: true; result: T } | { ran: false };

/** Longest a job may hold its lock; the transaction is aborted after that (a job taking 12 h is broken anyway). */
const MAX_JOB_MS = 12 * 3_600_000;

/** Run `fn` only when no other process runs the job with the same lock key; otherwise return { ran: false }. */
export async function withJobLock<T>(key: string, fn: () => Promise<T>): Promise<Locked<T>> {
  return db.$transaction(
    async (tx): Promise<Locked<T>> => {
      const [row] = await tx.$queryRaw<{ locked: boolean }[]>`SELECT pg_try_advisory_xact_lock(hashtext(${`job:${key}`})) AS locked`;
      if (!row?.locked) return { ran: false };
      return { ran: true, result: await fn() };
    },
    { maxWait: 10_000, timeout: MAX_JOB_MS },
  );
}
