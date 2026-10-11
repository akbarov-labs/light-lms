// Sends queued Notification rows (HANDOFF §9): ≤25 messages/second, retries, auditable status.
import { db } from "@/lib/db";

export type Sender = (chatId: string, text: string) => Promise<void>;

const MAX_ATTEMPTS = 5;
const GAP_MS = 40; // 25 msg/s

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function processNotifications(send: Sender, limit = 100): Promise<{ sent: number; failed: number }> {
  const batch = await db.notification.findMany({ where: { status: "PENDING", attempts: { lt: MAX_ATTEMPTS } }, orderBy: { createdAt: "asc" }, take: limit });
  let sent = 0;
  let failed = 0;
  for (const n of batch) {
    try {
      await send(n.chatId, n.text);
      await db.notification.update({ where: { id: n.id }, data: { status: "SENT", sentAt: new Date(), attempts: { increment: 1 }, error: null } });
      sent++;
    } catch (e) {
      const err = e as { error_code?: number; description?: string; message?: string };
      // 400/403: chat not found / bot blocked — retrying will not help
      const permanent = err.error_code === 403 || err.error_code === 400;
      const attempts = n.attempts + 1;
      await db.notification.update({
        where: { id: n.id },
        data: { attempts, error: String(err.description ?? err.message ?? e).slice(0, 500), status: permanent || attempts >= MAX_ATTEMPTS ? "FAILED" : "PENDING" },
      });
      failed++;
    }
    await sleep(GAP_MS);
  }
  return { sent, failed };
}
