import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { demoMode } from "@/config/brand";
import { issueSession } from "@/lib/auth/session-cookie";

export const dynamic = "force-dynamic";

// Relative Location: inside the container req.url is the bind address (0.0.0.0:3000), not what the visitor typed.
const go = (path: string) => new NextResponse(null, { status: 303, headers: { Location: path } });

/** Public demo server only: one click signs the visitor in as the demo center's owner. */
export async function GET() {
  if (!demoMode()) return go("/");
  const owner = await db.user.findFirst({
    where: { role: "OWNER", archivedAt: null, center: { slug: "demo", disabledAt: null } },
    select: { id: true, centerId: true },
  });
  if (!owner) return go("/login");
  await issueSession({ sub: owner.id, cid: owner.centerId });
  // ?demo: the proxy opens the dashboard here even when the visitor came from outside (see proxy.ts)
  return go("/?demo");
}
