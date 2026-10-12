// Postgres-backed AttemptStore (LoginAttempt table). Old rows are purged by the nightly job.
import { db } from "../db";
import type { AttemptStore } from "./ratelimit";

export const dbAttemptStore: AttemptStore = {
  async failures(key, since, afterSuccess) {
    let from = since;
    if (afterSuccess) {
      const ok = await db.loginAttempt.findFirst({ where: { key, success: true, createdAt: { gt: since } }, orderBy: { createdAt: "desc" }, select: { createdAt: true } });
      if (ok) from = ok.createdAt;
    }
    const rows = await db.loginAttempt.findMany({ where: { key, success: false, createdAt: { gt: from } }, select: { createdAt: true } });
    return rows.map((r) => r.createdAt);
  },
  async record(key, success, at) {
    await db.loginAttempt.create({ data: { key, success, createdAt: at } });
  },
  async clear(key) {
    await db.loginAttempt.deleteMany({ where: { key } });
  },
};

/** Purge attempts after 2 days: the longest window is 24 h (signupCreatedIp), so this leaves a margin. */
export async function purgeOldAttempts(now: Date = new Date()): Promise<{ attempts: number; resets: number }> {
  const [a, r] = await Promise.all([
    db.loginAttempt.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 2 * 24 * 3600_000) } } }),
    db.passwordReset.deleteMany({ where: { createdAt: { lt: new Date(now.getTime() - 7 * 24 * 3600_000) } } }),
  ]);
  return { attempts: a.count, resets: r.count };
}
