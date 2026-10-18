// Click SHOP-API endpoints: /api/click/prepare and /api/click/complete (form-urlencoded POST).
// /api/click/shop accepts both actions, for a cabinet that takes a single URL.
import { handleClick, type ClickParams } from "@/lib/payments/click";
import { prismaClickRepo } from "@/lib/payments/click-repo";

export const dynamic = "force-dynamic";

const EXPECT: Record<string, 0 | 1 | undefined> = { prepare: 0, complete: 1, shop: undefined };

async function params(req: Request): Promise<ClickParams> {
  const text = await req.text();
  if ((req.headers.get("content-type") ?? "").includes("application/json")) {
    try {
      const j = JSON.parse(text) as Record<string, unknown>;
      return Object.fromEntries(Object.entries(j).map(([k, v]) => [k, v === null || v === undefined ? undefined : String(v)]));
    } catch {
      return {};
    }
  }
  return Object.fromEntries(new URLSearchParams(text));
}

export async function POST(req: Request, { params: p }: { params: Promise<{ action: string }> }) {
  const { action } = await p;
  if (!(action in EXPECT)) return Response.json({ error: -3, error_note: "Action not found" }, { status: 404 });
  return Response.json(await handleClick(await params(req), prismaClickRepo, EXPECT[action]));
}
