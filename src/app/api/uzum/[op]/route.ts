// Uzum Bank Merchant API webhooks: /api/uzum/{check|create|confirm|reverse|status}.
import { handleUzum } from "@/lib/payments/uzum";
import { prismaUzumRepo } from "@/lib/payments/uzum-repo";

export const dynamic = "force-dynamic";

export async function POST(req: Request, { params }: { params: Promise<{ op: string }> }) {
  const { op } = await params;
  const r = await handleUzum(op, { auth: req.headers.get("authorization"), body: await req.text() }, prismaUzumRepo);
  return Response.json(r.body, { status: r.status });
}
