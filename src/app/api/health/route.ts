import { db } from "@/lib/db";

export const dynamic = "force-dynamic";

/** Public liveness check (Docker healthcheck, uptime monitors). Never returns error details. */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return Response.json({ ok: true, db: "up", time: new Date().toISOString() });
  } catch (e) {
    // details stay in the server log only
    console.error("[health] database check failed", e);
    return Response.json({ ok: false }, { status: 503 });
  }
}
