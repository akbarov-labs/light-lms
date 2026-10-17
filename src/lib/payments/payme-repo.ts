// Prisma-backed PaymeRepo. Perform and cancel post ledger rows in the same DB transaction.
import type { PaymeTransaction } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { postPayment, reverseEntry } from "@/lib/services/payments";
import { todayISO } from "@/lib/dates";
import { readSettings } from "@/lib/settings";
import { isUniqueViolation } from "@/lib/db-errors";
import { DuplicatePaymeTx, type PaymeRepo, type PaymeTx } from "./payme";

/** Fiscal receipt line title (receipts are printed in Uzbek). */
export const FISCAL_TITLE = "O'quv kurslari uchun to'lov";

const toTx = (r: PaymeTransaction): PaymeTx => ({
  id: r.id,
  paymeId: r.paymeId,
  centerId: r.centerId,
  familyId: r.familyId,
  amountTiyin: Number(r.amountTiyin),
  state: r.state as PaymeTx["state"],
  createTime: Number(r.createTime),
  paymeTime: r.paymeTime === null ? null : Number(r.paymeTime),
  performTime: r.performTime === null ? null : Number(r.performTime),
  cancelTime: r.cancelTime === null ? null : Number(r.cancelTime),
  reason: r.reason,
});

export const prismaPaymeRepo: PaymeRepo = {
  async centerByKey(key) {
    const c = await db.center.findFirst({ where: { paymeKey: key, paymeMerchantId: { not: null } }, select: { id: true, settings: true } });
    if (!c) return null;
    const f = readSettings(c.settings).paymeFiscal;
    return { id: c.id, fiscal: f ? { title: FISCAL_TITLE, ikpu: f.ikpu, packageCode: f.packageCode, vatPercent: f.vatPercent } : null };
  },
  async family(id) {
    return db.family.findUnique({ where: { id }, select: { id: true, centerId: true } });
  },
  async findTx(paymeId) {
    const r = await db.paymeTransaction.findUnique({ where: { paymeId } });
    return r ? toTx(r) : null;
  },
  async createTx(tx) {
    let r: PaymeTransaction;
    try {
      r = await db.paymeTransaction.create({
        data: {
          paymeId: tx.paymeId,
          centerId: tx.centerId,
          familyId: tx.familyId,
          amountTiyin: BigInt(tx.amountTiyin),
          state: tx.state,
          createTime: BigInt(tx.createTime),
          paymeTime: tx.paymeTime === null || tx.paymeTime === undefined ? null : BigInt(tx.paymeTime),
        },
      });
    } catch (e) {
      if (isUniqueViolation(e, "paymeId")) throw new DuplicatePaymeTx(tx.paymeId);
      throw e;
    }
    await db.auditLog.create({ data: { centerId: tx.centerId, entity: "PaymeTransaction", entityId: r.id, action: "create", after: { paymeId: tx.paymeId, amountTiyin: tx.amountTiyin } } });
    return toTx(r);
  },
  async perform(tx, now) {
    return db.$transaction(async (t) => {
      // row lock: Perform and Cancel of the same transaction never interleave
      await t.$queryRaw`SELECT id FROM "PaymeTransaction" WHERE id = ${tx.id} FOR UPDATE`;
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
      await t.$queryRaw`SELECT id FROM "PaymeTransaction" WHERE id = ${tx.id} FOR UPDATE`;
      const cur = await t.paymeTransaction.findUniqueOrThrow({ where: { id: tx.id } });
      if (cur.state < 0) return toTx(cur);
      if (cur.state === 2 && cur.ledgerEntryId) {
        const entry = await t.ledgerEntry.findUnique({ where: { id: cur.ledgerEntryId }, include: { reversedBy: { select: { id: true } } } });
        if (entry && !entry.reversedBy) {
          await reverseEntry(t, { userId: null, centerId: tx.centerId }, cur.ledgerEntryId, `Payme bekor qildi (reason ${reason})`);
        }
      }
      const r = await t.paymeTransaction.update({ where: { id: tx.id }, data: { state: cur.state === 2 ? -2 : -1, cancelTime: BigInt(now), reason } });
      await audit(t, { centerId: tx.centerId, entity: "PaymeTransaction", entityId: tx.id, action: "cancel", before: { state: cur.state }, after: { state: r.state, reason } });
      return toTx(r);
    }, { timeout: 30_000 });
  },
  // GetStatement is about Payme's clock: the "time" it sent in CreateTransaction (older rows without it
  // fall back to our create time), selected and ordered by that
  async statement(centerId, from, to) {
    const rows = await db.$queryRaw<PaymeTransaction[]>`
      SELECT * FROM "PaymeTransaction"
      WHERE "centerId" = ${centerId} AND COALESCE("paymeTime", "createTime") BETWEEN ${BigInt(from)} AND ${BigInt(to)}
      ORDER BY COALESCE("paymeTime", "createTime") ASC, "createTime" ASC, id ASC`;
    return rows.map(toTx);
  },
};
