// SMS rows of the notification queue → the center's own Eskiz account. Dry run (SMS_DRY_RUN=true, and
// always in DEMO_MODE) logs the message and marks it sent: no paid gateway is touched.
import { db } from "@/lib/db";
import { EskizClient, SmsError } from "@/lib/sms/eskiz";
import type { Sender } from "./notifications";

export function smsDryRun(): boolean {
  return process.env.SMS_DRY_RUN?.trim() === "true" || process.env.DEMO_MODE?.trim() === "true";
}

export function smsSender(opts: { client?: EskizClient; dryRun?: boolean; log?: (...a: unknown[]) => void } = {}): Sender {
  const client = opts.client ?? new EskizClient();
  const dryRun = opts.dryRun ?? smsDryRun();
  const log = opts.log ?? ((...a: unknown[]) => console.log(new Date().toISOString(), "[sms]", ...a));
  return async (phone, text, { centerId }) => {
    const c = await db.center.findUnique({ where: { id: centerId }, select: { smsLogin: true, smsPassword: true, smsFrom: true, disabledAt: true } });
    // the account was removed (or the center switched off) after the row was queued
    if (!c?.smsLogin || !c.smsPassword || c.disabledAt) throw new SmsError("permanent", "SMS is not configured for this center");
    if (dryRun) {
      log(`dry run → ${phone}: ${text.replace(/\n/g, " | ")}`);
      return;
    }
    await client.send({ login: c.smsLogin, password: c.smsPassword, from: c.smsFrom }, phone, text);
  };
}
