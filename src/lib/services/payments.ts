// Payments, reversals, refunds — HANDOFF §7. Ledger rows are never edited or deleted.
import type { PaymentMethod } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { fromISODate, todayISO, type ISODate } from "@/lib/dates";
import { UserError } from "@/lib/user-error";
import { enqueue, familyChats } from "@/lib/notify";
import { msg } from "@/lib/messages";
import { readSettings } from "@/lib/settings";
import { familyBalance } from "./wallet";
import type { Actor } from "./enrollments";

export interface PaymentInput {
  familyId: string;
  amount: number;
  method: PaymentMethod;
  date?: ISODate;
  enrollmentId?: string | null;
  studentId?: string | null;
  note?: string | null;
  externalId?: string | null;
}

const METHOD_LABEL: Record<PaymentMethod, string> = {
  CASH: "naqd",
  CARD: "karta",
  TRANSFER: "o'tkazma",
  PAYME: "Payme",
  CLICK: "Click",
  UZUM: "Uzum",
  SYSTEM: "tizim",
};

async function nextReceiptNo(tx: Tx, centerId: string): Promise<number> {
  const c = await tx.center.update({ where: { id: centerId }, data: { receiptSeq: { increment: 1 } }, select: { receiptSeq: true } });
  return c.receiptSeq;
}

/** Post a PAYMENT. Use inside an existing transaction (Payme) or on its own. */
export async function postPayment(tx: Tx, actor: Actor, p: PaymentInput) {
  if (!Number.isInteger(p.amount) || p.amount <= 0) throw new UserError("error.amount");
  const family = await tx.family.findUnique({ where: { id: p.familyId }, include: { center: { select: { name: true, settings: true } }, students: { select: { id: true, firstName: true, lastName: true } } } });
  if (!family || family.centerId !== actor.centerId) throw new UserError("error.notFound");
  let enrollmentId: string | null = null;
  let studentId = p.studentId ?? null;
  if (p.enrollmentId) {
    const e = await tx.enrollment.findUnique({ where: { id: p.enrollmentId }, include: { student: { select: { familyId: true } } } });
    if (!e || e.student.familyId !== family.id) throw new UserError("error.notFound");
    enrollmentId = e.id;
    studentId = e.studentId;
  }
  if (studentId && !family.students.some((s) => s.id === studentId)) throw new UserError("error.notFound");
  const date = p.date ?? todayISO();
  const receiptNo = await nextReceiptNo(tx, actor.centerId);
  const entry = await tx.ledgerEntry.create({
    data: {
      centerId: actor.centerId,
      familyId: family.id,
      studentId,
      enrollmentId,
      type: "PAYMENT",
      amount: p.amount,
      method: p.method,
      description: `To'lov · ${METHOD_LABEL[p.method]}${p.note ? ` · ${p.note}` : ""}`,
      receiptNo,
      date: fromISODate(date),
      createdById: actor.userId,
      externalId: p.externalId ?? null,
    },
  });
  await audit(tx, { centerId: actor.centerId, userId: actor.userId, entity: "LedgerEntry", entityId: entry.id, action: "payment", after: entry });
  if (readSettings(family.center.settings).notify.payment) {
    const balance = await familyBalance(family.id, tx);
    const student = family.students.find((s) => s.id === studentId) ?? family.students[0];
    const chats = await familyChats(tx, family.id);
    await enqueue(
      tx,
      actor.centerId,
      chats,
      (l) => msg.paymentReceived(l, { center: family.center.name, student: student ? `${student.firstName} ${student.lastName}` : family.name, amount: p.amount, balance, date }),
      `payment:${entry.id}`,
    );
  }
  return entry;
}

export async function takePayment(actor: Actor, p: PaymentInput) {
  return db.$transaction((tx) => postPayment(tx, actor, p), { timeout: 30_000 });
}

/** Cancel a payment or refund with an opposite REVERSAL entry. Caller checks `payments.refund`. */
export async function reverseEntry(tx: Tx, actor: Actor, entryId: string, reason: string | null) {
  const entry = await tx.ledgerEntry.findUnique({ where: { id: entryId }, include: { reversedBy: true } });
  if (!entry || entry.centerId !== actor.centerId) throw new UserError("error.notFound");
  if (entry.type !== "PAYMENT" && entry.type !== "REFUND") throw new UserError("error.notFound");
  if (entry.reversedBy) throw new UserError("error.reversed");
  const rev = await tx.ledgerEntry.create({
    data: {
      centerId: entry.centerId,
      familyId: entry.familyId,
      studentId: entry.studentId,
      enrollmentId: entry.enrollmentId,
      type: "REVERSAL",
      amount: -entry.amount,
      method: entry.method,
      reversesId: entry.id,
      description: `Bekor qilindi: ${entry.description}${reason ? ` · ${reason}` : ""}`,
      date: fromISODate(todayISO()),
      createdById: actor.userId,
    },
  });
  await audit(tx, { centerId: actor.centerId, userId: actor.userId, entity: "LedgerEntry", entityId: entry.id, action: "reverse", before: entry, after: { reversalId: rev.id, reason } });
  return rev;
}

export async function reversePayment(actor: Actor, entryId: string, reason: string | null) {
  return db.$transaction((tx) => reverseEntry(tx, actor, entryId, reason), { timeout: 30_000 });
}

/** Cash given back to a parent. Not an expense: revenue = payments − refunds. */
export async function refund(actor: Actor, p: { familyId: string; amount: number; method: PaymentMethod; date?: ISODate; reason: string | null; studentId?: string | null }) {
  if (!Number.isInteger(p.amount) || p.amount <= 0) throw new UserError("error.amount");
  return db.$transaction(async (tx) => {
    const family = await tx.family.findUnique({ where: { id: p.familyId } });
    if (!family || family.centerId !== actor.centerId) throw new UserError("error.notFound");
    const receiptNo = await nextReceiptNo(tx, actor.centerId);
    const entry = await tx.ledgerEntry.create({
      data: {
        centerId: actor.centerId,
        familyId: family.id,
        studentId: p.studentId ?? null,
        type: "REFUND",
        amount: -p.amount,
        method: p.method,
        description: `Qaytarildi · ${METHOD_LABEL[p.method]}${p.reason ? ` · ${p.reason}` : ""}`,
        receiptNo,
        date: fromISODate(p.date ?? todayISO()),
        createdById: actor.userId,
      },
    });
    await audit(tx, { centerId: actor.centerId, userId: actor.userId, entity: "LedgerEntry", entityId: entry.id, action: "refund", after: entry });
    return entry;
  });
}
