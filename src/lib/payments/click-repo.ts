// Prisma-backed ClickRepo. Confirm posts the PAYMENT in the same DB transaction as the state change.
import type { ClickTransaction } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { postPayment } from "@/lib/services/payments";
import { todayISO } from "@/lib/dates";
import { isUniqueViolation } from "@/lib/db-errors";
import type { ClickRepo, ClickTx } from "./click";

const toTx = (r: ClickTransaction): ClickTx => ({
  id: r.id,
  centerId: r.centerId,
  clickTransId: r.clickTransId,
  familyId: r.familyId,
  amount: r.amount,
  prepareId: r.prepareId,
  state: r.state as ClickTx["state"],
});

export const prismaClickRepo: ClickRepo = {
  async centerByService(serviceId) {
    const c = await db.center.findUnique({ where: { clickServiceId: serviceId }, select: { id: true, clickSecretKey: true, clickMerchantId: true, disabledAt: true } });
    if (!c?.clickSecretKey || !c.clickMerchantId || c.disabledAt) return null;
    return { id: c.id, secretKey: c.clickSecretKey };
  },
  async family(id) {
    return db.family.findUnique({ where: { id }, select: { id: true, centerId: true } });
  },
  async byClickId(clickTransId) {
    const r = await db.clickTransaction.findUnique({ where: { clickTransId } });
    return r ? toTx(r) : null;
  },
  async byPrepareId(prepareId) {
    const r = await db.clickTransaction.findUnique({ where: { prepareId } });
    return r ? toTx(r) : null;
  },
  async prepare(tx) {
    try {
      const r = await db.clickTransaction.create({ data: tx });
      await db.auditLog.create({ data: { centerId: tx.centerId, entity: "ClickTransaction", entityId: r.id, action: "prepare", after: { clickTransId: tx.clickTransId, amount: tx.amount } } });
      return toTx(r);
    } catch (e) {
      if (!isUniqueViolation(e, "clickTransId")) throw e;
      return toTx(await db.clickTransaction.findUniqueOrThrow({ where: { clickTransId: tx.clickTransId } }));
    }
  },
  async confirm(tx) {
    return db.$transaction(async (t) => {
      await t.$queryRaw`SELECT id FROM "ClickTransaction" WHERE id = ${tx.id} FOR UPDATE`;
      const claimed = await t.clickTransaction.updateMany({ where: { id: tx.id, state: 0 }, data: { state: 1, completedAt: new Date() } });
      if (claimed.count === 0) return toTx(await t.clickTransaction.findUniqueOrThrow({ where: { id: tx.id } }));
      const entry = await postPayment(t, { userId: null, centerId: tx.centerId }, {
        familyId: tx.familyId,
        amount: tx.amount,
        method: "CLICK",
        date: todayISO(),
        externalId: tx.clickTransId,
        note: tx.clickTransId,
      });
      const r = await t.clickTransaction.update({ where: { id: tx.id }, data: { ledgerEntryId: entry.id } });
      await audit(t, { centerId: tx.centerId, entity: "ClickTransaction", entityId: tx.id, action: "complete", after: { ledgerEntryId: entry.id } });
      return toTx(r);
    }, { timeout: 30_000 });
  },
  async cancel(tx, clickError) {
    return db.$transaction(async (t) => {
      await t.$queryRaw`SELECT id FROM "ClickTransaction" WHERE id = ${tx.id} FOR UPDATE`;
      const cur = await t.clickTransaction.findUniqueOrThrow({ where: { id: tx.id } });
      if (cur.state !== 0) return toTx(cur);
      const r = await t.clickTransaction.update({ where: { id: tx.id }, data: { state: -1, error: clickError, completedAt: new Date() } });
      await audit(t, { centerId: tx.centerId, entity: "ClickTransaction", entityId: tx.id, action: "cancel", after: { error: clickError } });
      return toTx(r);
    });
  },
};
