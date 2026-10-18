// Prisma-backed UzumRepo. Confirm and reverse post ledger rows in the same DB transaction.
import type { UzumTransaction } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { postPayment, reverseEntry } from "@/lib/services/payments";
import { todayISO } from "@/lib/dates";
import { isUniqueViolation } from "@/lib/db-errors";
import type { UzumRepo, UzumTx } from "./uzum";

const n = (v: bigint | null) => (v === null ? null : Number(v));
const toTx = (r: UzumTransaction): UzumTx => ({
  id: r.id,
  centerId: r.centerId,
  transId: r.transId,
  familyId: r.familyId,
  amountTiyin: Number(r.amountTiyin),
  state: r.state,
  createTime: Number(r.createTime),
  confirmTime: n(r.confirmTime),
  reverseTime: n(r.reverseTime),
});

export const prismaUzumRepo: UzumRepo = {
  async centerByService(serviceId) {
    const c = await db.center.findUnique({ where: { uzumServiceId: serviceId }, select: { id: true, uzumLogin: true, uzumPassword: true, disabledAt: true } });
    if (!c?.uzumLogin || !c.uzumPassword || c.disabledAt) return null;
    return { id: c.id, login: c.uzumLogin, password: c.uzumPassword };
  },
  async family(id) {
    return db.family.findUnique({ where: { id }, select: { id: true, centerId: true } });
  },
  async findTx(transId) {
    const r = await db.uzumTransaction.findUnique({ where: { transId } });
    return r ? toTx(r) : null;
  },
  async createTx(tx) {
    try {
      const r = await db.uzumTransaction.create({ data: { centerId: tx.centerId, transId: tx.transId, familyId: tx.familyId, amountTiyin: BigInt(tx.amountTiyin), createTime: BigInt(tx.createTime) } });
      await db.auditLog.create({ data: { centerId: tx.centerId, entity: "UzumTransaction", entityId: r.id, action: "create", after: { transId: tx.transId, amountTiyin: tx.amountTiyin } } });
      return toTx(r);
    } catch (e) {
      if (!isUniqueViolation(e, "transId")) throw e;
      return toTx(await db.uzumTransaction.findUniqueOrThrow({ where: { transId: tx.transId } }));
    }
  },
  async confirm(tx, now, paymentSource) {
    return db.$transaction(async (t) => {
      await t.$queryRaw`SELECT id FROM "UzumTransaction" WHERE id = ${tx.id} FOR UPDATE`;
      const claimed = await t.uzumTransaction.updateMany({ where: { id: tx.id, state: "CREATED" }, data: { state: "CONFIRMED", confirmTime: BigInt(now), paymentSource } });
      if (claimed.count === 0) return toTx(await t.uzumTransaction.findUniqueOrThrow({ where: { id: tx.id } }));
      const entry = await postPayment(t, { userId: null, centerId: tx.centerId }, {
        familyId: tx.familyId,
        amount: Math.round(tx.amountTiyin / 100),
        method: "UZUM",
        date: todayISO(new Date(now)),
        externalId: tx.transId,
        note: tx.transId,
      });
      const r = await t.uzumTransaction.update({ where: { id: tx.id }, data: { ledgerEntryId: entry.id } });
      await audit(t, { centerId: tx.centerId, entity: "UzumTransaction", entityId: tx.id, action: "confirm", after: { ledgerEntryId: entry.id } });
      return toTx(r);
    }, { timeout: 30_000 });
  },
  async reverse(tx, now) {
    return db.$transaction(async (t) => {
      await t.$queryRaw`SELECT id FROM "UzumTransaction" WHERE id = ${tx.id} FOR UPDATE`;
      const cur = await t.uzumTransaction.findUniqueOrThrow({ where: { id: tx.id } });
      if (cur.state === "REVERSED" || cur.state === "FAILED") return toTx(cur);
      if (cur.state === "CONFIRMED" && cur.ledgerEntryId) {
        const entry = await t.ledgerEntry.findUnique({ where: { id: cur.ledgerEntryId }, include: { reversedBy: { select: { id: true } } } });
        if (entry && !entry.reversedBy) await reverseEntry(t, { userId: null, centerId: tx.centerId }, cur.ledgerEntryId, "Uzum bekor qildi");
      }
      const r = await t.uzumTransaction.update({ where: { id: tx.id }, data: { state: "REVERSED", reverseTime: BigInt(now) } });
      await audit(t, { centerId: tx.centerId, entity: "UzumTransaction", entityId: tx.id, action: "reverse", before: { state: cur.state }, after: { state: "REVERSED" } });
      return toTx(r);
    }, { timeout: 30_000 });
  },
};
