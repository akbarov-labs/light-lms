// Prisma-backed PaymeRepo. Perform and cancel post ledger rows in the same DB transaction.
import type { PaymeTransaction } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { postPayment, reverseEntry } from "@/lib/services/payments";
import { todayISO } from "@/lib/dates";
import type { PaymeRepo, PaymeTx } from "./payme";

const toTx = (r: PaymeTransaction): PaymeTx => ({
  id: r.id,
  paymeId: r.paymeId,
  centerId: r.centerId,
  familyId: r.familyId,
  amountTiyin: Number(r.amountTiyin),
  state: r.state as PaymeTx["state"],
  createTime: Number(r.createTime),
  performTime: r.performTime === null ? null : Number(r.performTime),
  cancelTime: r.cancelTime === null ? null : Number(r.cancelTime),
  reason: r.reason,
});

export const prismaPaymeRepo: PaymeRepo = {
  async centerByKey(key) {
    return db.center.findFirst({ where: { paymeKey: key, paymeMerchantId: { not: null } }, select: { id: true } });
  },
  async family(id) {
    return db.family.findUnique({ where: { id }, select: { id: true, centerId: true } });
  },
  async findTx(paymeId) {
    const r = await db.paymeTransaction.findUnique({ where: { paymeId } });
    return r ? toTx(r) : null;
  },
  async activeTxForFamily(familyId) {
    const r = await db.paymeTransaction.findFirst({ where: { familyId, state: 1 }, orderBy: { createTime: "desc" } });
    return r ? toTx(r) : null;
  },
  async createTx(tx) {
    const r = await db.paymeTransaction.create({
      data: { paymeId: tx.paymeId, centerId: tx.centerId, familyId: tx.familyId, amountTiyin: BigInt(tx.amountTiyin), state: tx.state, createTime: BigInt(tx.createTime) },
    });
    await db.auditLog.create({ data: { centerId: tx.centerId, entity: "PaymeTransaction", entityId: r.id, action: "create", after: { paymeId: tx.paymeId, amountTiyin: tx.amountTiyin } } });
    return toTx(r);
  },
  async perform(tx, now) {
    return db.$transaction(async (t) => {
      const claimed = await t.paymeTransaction.updateMany({ where: { id: tx.id, state: 1 }, data: { state: 2, performTime: BigInt(now) } });
      if (claimed.count === 0) return toTx(await t.paymeTransaction.findUniqueOrThrow({ where: { id: tx.id } }));
      const entry = await postPayment(t, { userId: null, centerId: tx.centerId }, {
        familyId: tx.familyId,
        amount: Math.round(tx.amountTiyin / 100),
        method: "PAYME",
        date: todayISO(new Date(now)),
        externalId: tx.paymeId,
        note: tx.paymeId,
      });
      const r = await t.paymeTransaction.update({ where: { id: tx.id }, data: { ledgerEntryId: entry.id } });
      await audit(t, { centerId: tx.centerId, entity: "PaymeTransaction", entityId: tx.id, action: "perform", after: { ledgerEntryId: entry.id } });
      return toTx(r);
    }, { timeout: 30_000 });
  },
  async cancel(tx, reason, now) {
    return db.$transaction(async (t) => {
      const cur = await t.paymeTransaction.findUniqueOrThrow({ where: { id: tx.id } });
      if (cur.state < 0) return toTx(cur);
      if (cur.state === 2 && cur.ledgerEntryId) {
        await reverseEntry(t, { userId: null, centerId: tx.centerId }, cur.ledgerEntryId, `Payme bekor qildi (reason ${reason})`);
      }
      const r = await t.paymeTransaction.update({ where: { id: tx.id }, data: { state: cur.state === 2 ? -2 : -1, cancelTime: BigInt(now), reason } });
      await audit(t, { centerId: tx.centerId, entity: "PaymeTransaction", entityId: tx.id, action: "cancel", before: { state: cur.state }, after: { state: r.state, reason } });
      return toTx(r);
    }, { timeout: 30_000 });
  },
  async statement(centerId, from, to) {
    const rows = await db.paymeTransaction.findMany({ where: { centerId, createTime: { gte: BigInt(from), lte: BigInt(to) } }, orderBy: { createTime: "asc" } });
    return rows.map(toTx);
  },
};
