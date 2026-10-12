// Attempt limiting for login and password-reset codes (sliding window, DB-backed via AttemptStore).
// Pure decision logic lives here so it is unit-tested; attempts-db.ts is the Postgres store.

export interface Rule {
  /** failures allowed inside the window; the next one is refused */
  limit: number;
  windowMs: number;
  /** a success clears earlier failures (per-phone yes; per-IP no, or an attacker resets it with their own account) */
  resetOnSuccess: boolean;
}

const MIN = 60_000;

export const RULES = {
  loginPhone: { limit: 5, windowMs: 15 * MIN, resetOnSuccess: true },
  // a whole reception desk shares one NAT address, so the IP budget is generous
  loginIp: { limit: 30, windowMs: 15 * MIN, resetOnSuccess: false },
  resetRequestPhone: { limit: 3, windowMs: 60 * MIN, resetOnSuccess: false },
  resetRequestIp: { limit: 10, windowMs: 60 * MIN, resetOnSuccess: false },
  resetVerifyIp: { limit: 20, windowMs: 15 * MIN, resetOnSuccess: false },
  // public "create your center": every attempt counts; a created center is recorded as spent budget too
  signupIp: { limit: 5, windowMs: 15 * MIN, resetOnSuccess: false },
  signupCreatedIp: { limit: 3, windowMs: 24 * 60 * MIN, resetOnSuccess: false },
  // public lead form: a real visitor sends one or two; a script sending hundreds is stopped
  leadIp: { limit: 10, windowMs: 60 * MIN, resetOnSuccess: false },
} satisfies Record<string, Rule>;

export type RuleName = keyof typeof RULES;

export interface AttemptStore {
  /** failure times for `key` newer than `since` (and newer than the last success when `afterSuccess`) */
  failures(key: string, since: Date, afterSuccess: boolean): Promise<Date[]>;
  record(key: string, success: boolean, at: Date): Promise<void>;
  clear(key: string): Promise<void>;
}

export interface Check {
  key: string;
  rule: Rule;
}

/** Milliseconds until another attempt is allowed; 0 = allowed now. */
export function retryAfterMs(failures: Date[], rule: Rule, now: Date): number {
  const t = now.getTime();
  const inWindow = failures.map((d) => d.getTime()).filter((x) => x > t - rule.windowMs).sort((a, b) => a - b);
  if (inWindow.length < rule.limit) return 0;
  // allowed again once enough of the oldest failures leave the window to get below the limit
  const freeing = inWindow[inWindow.length - rule.limit];
  return Math.max(0, freeing + rule.windowMs - t);
}

export interface Verdict {
  allowed: boolean;
  retryAfterMs: number;
}

/** Allowed only if every check is under its limit; the wait is the longest of the blocked ones. */
export async function checkAttempts(store: AttemptStore, checks: Check[], now: Date = new Date()): Promise<Verdict> {
  let wait = 0;
  for (const c of checks) {
    const f = await store.failures(c.key, new Date(now.getTime() - c.rule.windowMs), c.rule.resetOnSuccess);
    wait = Math.max(wait, retryAfterMs(f, c.rule, now));
  }
  return { allowed: wait === 0, retryAfterMs: wait };
}

export async function recordAttempt(store: AttemptStore, keys: string[], success: boolean, now: Date = new Date()): Promise<void> {
  for (const k of keys) await store.record(k, success, now);
}

/** Whole minutes for the lockout message, at least 1. */
export function retryMinutes(ms: number): number {
  return Math.max(1, Math.ceil(ms / MIN));
}

export const attemptKey = {
  loginPhone: (phone: string) => `login:phone:${phone}`,
  loginIp: (ip: string) => `login:ip:${ip}`,
  resetRequestPhone: (phone: string) => `reset-req:phone:${phone}`,
  resetRequestIp: (ip: string) => `reset-req:ip:${ip}`,
  resetVerifyIp: (ip: string) => `reset-verify:ip:${ip}`,
  signupIp: (ip: string) => `signup:ip:${ip}`,
  signupCreatedIp: (ip: string) => `signup-created:ip:${ip}`,
  leadIp: (ip: string) => `lead:ip:${ip}`,
};

/** In-memory store for tests and scripts. */
export class MemoryAttemptStore implements AttemptStore {
  rows: { key: string; success: boolean; at: Date }[] = [];
  async failures(key: string, since: Date, afterSuccess: boolean): Promise<Date[]> {
    const mine = this.rows.filter((r) => r.key === key);
    let from = since.getTime();
    if (afterSuccess) {
      const lastOk = mine.filter((r) => r.success).reduce((m, r) => Math.max(m, r.at.getTime()), -Infinity);
      from = Math.max(from, lastOk);
    }
    return mine.filter((r) => !r.success && r.at.getTime() > from).map((r) => r.at);
  }
  async record(key: string, success: boolean, at: Date): Promise<void> {
    this.rows.push({ key, success, at });
  }
  async clear(key: string): Promise<void> {
    this.rows = this.rows.filter((r) => r.key !== key);
  }
}
