// Payme Merchant API endpoint. Payme calls this with JSON-RPC 2.0 + Basic auth (HANDOFF §10).
import { handlePayme } from "@/lib/payments/payme";
import { prismaPaymeRepo } from "@/lib/payments/payme-repo";

export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const body = await req.text();
  const res = await handlePayme({ auth: req.headers.get("authorization"), body }, prismaPaymeRepo);
  return Response.json(res);
}

export async function GET() {
  return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32300, message: { ru: "Метод должен быть POST", uz: "POST bo'lishi kerak", en: "Method must be POST" } } });
}
