// SaaS plans: each caps the number of active students (HANDOFF §1 pricing proposal).
// Pure functions only — the DB count lives in services/plan-usage.ts. No billing integration yet.

export const PLAN_NAMES = ["FREE", "START", "GROWTH", "PRO"] as const;
export type PlanName = (typeof PLAN_NAMES)[number];

export interface PlanInfo {
  name: PlanName;
  /** Max active students. */
  limit: number;
  /** List price per month in UZS (informational until billing exists). */
  monthlyPrice: number;
}

export const PLANS: Record<PlanName, PlanInfo> = {
  FREE: { name: "FREE", limit: 30, monthlyPrice: 0 },
  START: { name: "START", limit: 100, monthlyPrice: 249_000 },
  GROWTH: { name: "GROWTH", limit: 300, monthlyPrice: 590_000 },
  PRO: { name: "PRO", limit: 1000, monthlyPrice: 990_000 },
};

/** Share of the limit at which the owner is warned. */
export const NEAR_LIMIT = 0.9;

export function isPlan(v: unknown): v is PlanName {
  return typeof v === "string" && (PLAN_NAMES as readonly string[]).includes(v);
}

export function planLimit(plan: PlanName): number {
  return PLANS[plan].limit;
}

/** Smallest plan that fits `active` students; null when even the biggest is too small. */
export function planFor(active: number): PlanName | null {
  return PLAN_NAMES.find((p) => PLANS[p].limit >= active) ?? null;
}

export type UsageLevel = "ok" | "near" | "full" | "over";

export interface PlanUsage {
  plan: PlanName;
  limit: number;
  used: number;
  remaining: number;
  /** 0–100, capped at 100 for progress bars. */
  percent: number;
  level: UsageLevel;
}

export function planUsage(plan: PlanName, used: number): PlanUsage {
  const limit = planLimit(plan);
  const level: UsageLevel = used > limit ? "over" : used === limit ? "full" : used >= Math.ceil(limit * NEAR_LIMIT) ? "near" : "ok";
  return { plan, limit, used, remaining: Math.max(0, limit - used), percent: Math.min(100, Math.round((used / limit) * 100)), level };
}

/**
 * May one more student become active? A student who is already active (another open ACTIVE/FROZEN
 * enrollment) does not add to the count, so moving or adding groups is never blocked.
 */
export function canActivate(plan: PlanName, activeNow: number, alreadyActive: boolean): boolean {
  if (alreadyActive) return true;
  return activeNow + 1 <= planLimit(plan);
}

/** How many of `newStudents` (not yet active) still fit — for bulk imports. */
export function seatsLeft(plan: PlanName, activeNow: number): number {
  return Math.max(0, planLimit(plan) - activeNow);
}
