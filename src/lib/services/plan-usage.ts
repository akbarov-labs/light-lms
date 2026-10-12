// Plan limits against the database. "Active student" = same rule as the dashboard:
// status ACTIVE with an open ACTIVE or FROZEN enrollment (trials are free and don't count).
import { db, type Tx } from "@/lib/db";
import { canActivate, isPlan, planUsage, type PlanName, type PlanUsage } from "@/lib/plans";
import { UserError } from "@/lib/user-error";

type Client = Tx | typeof db;

const OPEN_BILLED = { endDate: null, status: { in: ["ACTIVE" as const, "FROZEN" as const] } };

export function countActiveStudents(client: Client, centerId: string): Promise<number> {
  return client.student.count({ where: { centerId, status: "ACTIVE", enrollments: { some: OPEN_BILLED } } });
}

async function isStudentActive(client: Client, studentId: string): Promise<boolean> {
  return (await client.enrollment.count({ where: { studentId, ...OPEN_BILLED } })) > 0;
}

export async function centerPlan(client: Client, centerId: string): Promise<PlanName> {
  const c = await client.center.findUnique({ where: { id: centerId }, select: { plan: true } });
  return c && isPlan(c.plan) ? c.plan : "FREE";
}

export async function centerUsage(centerId: string): Promise<PlanUsage> {
  const [plan, used] = await Promise.all([centerPlan(db, centerId), countActiveStudents(db, centerId)]);
  return planUsage(plan, used);
}

/** Throws "plan.limitReached" when making this student active would go past the center's plan. */
export async function assertSeatFor(client: Client, centerId: string, studentId: string): Promise<void> {
  if (await isStudentActive(client, studentId)) return;
  const [plan, used] = await Promise.all([centerPlan(client, centerId), countActiveStudents(client, centerId)]);
  if (!canActivate(plan, used, false)) throw new UserError("plan.limitReached", { limit: planUsage(plan, used).limit });
}

/** Active students per center (platform admin list). */
export async function activeStudentsByCenter(): Promise<Map<string, number>> {
  const rows = await db.$queryRaw<{ centerId: string; n: bigint }[]>`
    SELECT s."centerId", COUNT(DISTINCT s.id) AS n
    FROM "Student" s
    JOIN "Enrollment" e ON e."studentId" = s.id
    WHERE s.status = 'ACTIVE' AND e."endDate" IS NULL AND e.status IN ('ACTIVE', 'FROZEN')
    GROUP BY s."centerId"`;
  return new Map(rows.map((r) => [r.centerId, Number(r.n)]));
}
