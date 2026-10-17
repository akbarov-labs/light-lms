// Enrollment lifecycle — HANDOFF §6 "Enrollment rules". Every change: audit row + billing sync,
// in one transaction.
import { db, type Tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { addDays, fromISODate, toISODate, todayISO, type ISODate } from "@/lib/dates";
import type { Prisma } from "@prisma/client";
import { parseTermsHistory, syncEnrollment } from "@/lib/billing/sync";
import { UserError } from "@/lib/user-error";
import { enqueue, familyChats } from "@/lib/notify";
import { msg } from "@/lib/messages";
import { readSettings } from "@/lib/settings";
import { advanceLeadsForStudent } from "./leads";
import { assertSeatFor } from "./plan-usage";

export interface Actor {
  userId: string | null;
  centerId: string;
}

const TX = { timeout: 30_000 };

async function loadEnrollment(tx: Tx, actor: Actor, id: string) {
  const e = await tx.enrollment.findUnique({
    where: { id },
    include: { group: { select: { id: true, centerId: true, branchId: true, name: true, code: true } }, student: { select: { id: true, firstName: true, lastName: true, familyId: true, centerId: true } } },
  });
  if (!e || e.student.centerId !== actor.centerId) throw new UserError("error.notFound");
  return e;
}

/** First lesson of the group on/after `from` that is not cancelled. */
export async function nextLessonDate(tx: Tx, groupId: string, from: ISODate): Promise<ISODate | null> {
  const l = await tx.lesson.findFirst({
    where: { groupId, date: { gte: fromISODate(from) }, status: { not: "CANCELLED" } },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
    select: { date: true },
  });
  return l ? toISODate(l.date) : null;
}

async function openCount(tx: Tx, groupId: string): Promise<number> {
  return tx.enrollment.count({ where: { groupId, endDate: null, status: { in: ["TRIAL", "ACTIVE", "FROZEN"] } } });
}

export interface EnrollInput {
  studentId: string;
  groupId: string;
  startDate: ISODate;
  trial: boolean;
  priceOverride?: number | null;
  discountPercent?: number | null;
  discountAmount?: number | null;
  discountUntil?: ISODate | null;
  discountReason?: string | null;
}

export async function enrollStudent(actor: Actor, input: EnrollInput, branchCheck?: (branchId: string) => void): Promise<string> {
  return db.$transaction(async (tx) => {
    const [student, group] = await Promise.all([
      tx.student.findUnique({ where: { id: input.studentId }, select: { id: true, centerId: true, familyId: true, firstName: true, lastName: true } }),
      tx.group.findUnique({ where: { id: input.groupId }, include: { branch: true, center: { select: { name: true } } } }),
    ]);
    if (!student || student.centerId !== actor.centerId || !group || group.centerId !== actor.centerId) throw new UserError("error.notFound");
    branchCheck?.(group.branchId);
    const open = await tx.enrollment.findFirst({ where: { studentId: student.id, groupId: group.id, endDate: null } });
    if (open) throw new UserError("error.alreadyEnrolled");
    if (group.capacity && (await openCount(tx, group.id)) >= group.capacity) throw new UserError("error.groupFull", { capacity: group.capacity });
    if (!input.trial) await assertSeatFor(tx, actor.centerId, student.id);

    const e = await tx.enrollment.create({
      data: {
        studentId: student.id,
        groupId: group.id,
        startDate: fromISODate(input.startDate),
        status: input.trial ? "TRIAL" : "ACTIVE",
        activatedAt: input.trial ? null : fromISODate(input.startDate),
        priceOverride: input.priceOverride ?? null,
        discountPercent: input.discountPercent ?? null,
        discountAmount: input.discountAmount ?? null,
        discountUntil: input.discountUntil ? fromISODate(input.discountUntil) : null,
        discountReason: input.discountReason ?? null,
      },
    });
    await audit(tx, { centerId: actor.centerId, userId: actor.userId, entity: "Enrollment", entityId: e.id, action: input.trial ? "enroll.trial" : "enroll.active", after: e });
    await advanceLeadsForStudent(tx, actor.centerId, student.id, input.trial ? "TRIAL_BOOKED" : "ENROLLED", actor.userId);
    if (input.trial) {
      const first = await tx.lesson.findFirst({
        where: { groupId: group.id, date: { gte: fromISODate(input.startDate) }, status: { not: "CANCELLED" } },
        orderBy: [{ date: "asc" }, { startTime: "asc" }],
      });
      if (first) {
        const chats = await familyChats(tx, student.familyId, student.id);
        await enqueue(tx, actor.centerId, chats, (l) =>
          msg.trialBooked(l, {
            center: group.center.name,
            student: `${student.firstName} ${student.lastName}`,
            group: group.name,
            date: toISODate(first.date),
            time: first.startTime,
            address: group.branch.address,
          }),
        `trial:${e.id}`);
      }
    }
    await syncEnrollment(e.id, { tx, userId: actor.userId });
    return e.id;
  }, TX);
}

/** Start billing. `date` defaults to the next lesson from today (or today). */
export async function activateEnrollment(actor: Actor, enrollmentId: string, date?: ISODate, tx?: Tx): Promise<void> {
  const run = async (tx: Tx) => {
    const e = await loadEnrollment(tx, actor, enrollmentId);
    if (e.status !== "TRIAL") return;
    await assertSeatFor(tx, actor.centerId, e.studentId);
    const picked = date ?? (await nextLessonDate(tx, e.groupId, todayISO())) ?? todayISO();
    const when = picked < toISODate(e.startDate) ? toISODate(e.startDate) : picked;
    const updated = await tx.enrollment.update({ where: { id: e.id }, data: { status: "ACTIVE", activatedAt: fromISODate(when) } });
    await audit(tx, { centerId: actor.centerId, userId: actor.userId, entity: "Enrollment", entityId: e.id, action: "activate", before: { status: e.status }, after: { status: updated.status, activatedAt: when } });
    await advanceLeadsForStudent(tx, actor.centerId, e.studentId, "ENROLLED", actor.userId);
    await syncEnrollment(e.id, { tx, userId: actor.userId });
  };
  if (tx) return run(tx);
  return db.$transaction(run, TX);
}

export async function transferEnrollment(actor: Actor, enrollmentId: string, toGroupId: string, moveDate: ISODate, branchCheck?: (branchId: string) => void): Promise<string> {
  return db.$transaction(async (tx) => {
    const e = await loadEnrollment(tx, actor, enrollmentId);
    if (e.endDate) throw new UserError("error.notFound");
    if (e.groupId === toGroupId) throw new UserError("error.sameGroup");
    if (moveDate <= toISODate(e.startDate)) throw new UserError("error.transferDate");
    const target = await tx.group.findUnique({ where: { id: toGroupId }, include: { center: { select: { settings: true } } } });
    if (!target || target.centerId !== actor.centerId) throw new UserError("error.notFound");
    branchCheck?.(target.branchId);
    if (await tx.enrollment.findFirst({ where: { studentId: e.studentId, groupId: toGroupId, endDate: null } })) throw new UserError("error.alreadyEnrolled");
    if (target.capacity && (await openCount(tx, target.id)) >= target.capacity) throw new UserError("error.groupFull", { capacity: target.capacity });

    const asTrial = e.status === "TRIAL" || readSettings(target.center.settings).transferAsTrial;
    const created = await tx.enrollment.create({
      data: {
        studentId: e.studentId,
        groupId: toGroupId,
        startDate: fromISODate(moveDate),
        status: asTrial ? "TRIAL" : "ACTIVE",
        activatedAt: asTrial ? null : fromISODate(moveDate),
        discountPercent: e.discountPercent,
        discountAmount: e.discountAmount,
        discountUntil: e.discountUntil,
        discountReason: e.discountReason,
        // the price override belonged to the old group; only the discount moves along
      },
    });
    await tx.enrollment.update({
      where: { id: e.id },
      data: { endDate: fromISODate(addDays(moveDate, -1)), status: "TRANSFERRED", transferredToId: created.id },
    });
    await audit(tx, {
      centerId: actor.centerId,
      userId: actor.userId,
      entity: "Enrollment",
      entityId: e.id,
      action: "transfer",
      before: { groupId: e.groupId, status: e.status },
      after: { toGroupId, newEnrollmentId: created.id, moveDate },
    });
    await syncEnrollment(e.id, { tx, userId: actor.userId });
    await syncEnrollment(created.id, { tx, userId: actor.userId });
    return created.id;
  }, TX);
}

export async function freezeEnrollment(actor: Actor, enrollmentId: string, from: ISODate, to: ISODate, reason: string | null): Promise<void> {
  if (to < from) throw new UserError("error.freezeRange");
  await db.$transaction(async (tx) => {
    const e = await loadEnrollment(tx, actor, enrollmentId);
    if (e.endDate) throw new UserError("error.notFound");
    const f = await tx.enrollmentFreeze.create({ data: { enrollmentId, fromDate: fromISODate(from), toDate: fromISODate(to), reason } });
    const today = todayISO();
    if (e.status === "ACTIVE" && from <= today && today <= to) await tx.enrollment.update({ where: { id: e.id }, data: { status: "FROZEN" } });
    await audit(tx, { centerId: actor.centerId, userId: actor.userId, entity: "Enrollment", entityId: e.id, action: "freeze", after: f });
    await syncEnrollment(e.id, { tx, userId: actor.userId });
  }, TX);
}

/** End a freeze early (or move its end). The record is kept for history. */
export async function endFreeze(actor: Actor, freezeId: string, newTo: ISODate): Promise<void> {
  await db.$transaction(async (tx) => {
    const f = await tx.enrollmentFreeze.findUnique({ where: { id: freezeId } });
    if (!f) throw new UserError("error.notFound");
    const e = await loadEnrollment(tx, actor, f.enrollmentId);
    const from = toISODate(f.fromDate);
    const to = newTo < from ? from : newTo;
    await tx.enrollmentFreeze.update({ where: { id: f.id }, data: { toDate: fromISODate(to) } });
    const today = todayISO();
    if (e.status === "FROZEN" && to < today) await tx.enrollment.update({ where: { id: e.id }, data: { status: "ACTIVE" } });
    await audit(tx, { centerId: actor.centerId, userId: actor.userId, entity: "Enrollment", entityId: e.id, action: "freeze.end", before: { to: toISODate(f.toDate) }, after: { to } });
    await syncEnrollment(e.id, { tx, userId: actor.userId });
  }, TX);
}

export async function leaveEnrollment(actor: Actor, enrollmentId: string, endDate: ISODate, reason: string | null): Promise<void> {
  await db.$transaction(async (tx) => {
    const e = await loadEnrollment(tx, actor, enrollmentId);
    if (e.endDate) throw new UserError("error.notFound");
    const end = endDate < toISODate(e.startDate) ? toISODate(e.startDate) : endDate;
    await tx.enrollment.update({ where: { id: e.id }, data: { endDate: fromISODate(end), status: "LEFT", leftReason: reason } });
    await audit(tx, { centerId: actor.centerId, userId: actor.userId, entity: "Enrollment", entityId: e.id, action: "leave", before: { status: e.status }, after: { status: "LEFT", endDate: end, reason } });
    await syncEnrollment(e.id, { tx, userId: actor.userId });
  }, TX);
}

export interface PriceTerms {
  priceOverride: number | null;
  discountPercent: number | null;
  discountAmount: number | null;
  discountUntil: ISODate | null;
  discountReason: string | null;
}

/**
 * New price / discount for an enrollment, effective for billing units starting on/after `from`.
 * Earlier units keep the terms they were charged with (Enrollment.termsHistory).
 */
export async function setEnrollmentTerms(actor: Actor, enrollmentId: string, terms: PriceTerms, from: ISODate): Promise<void> {
  await db.$transaction(async (tx) => {
    const e = await loadEnrollment(tx, actor, enrollmentId);
    const iso = (d: Date | null) => (d ? toISODate(d) : null);
    let history = parseTermsHistory(e.termsHistory);
    if (history.length === 0) {
      history = [{ from: "2000-01-01", priceOverride: e.priceOverride, discountPercent: e.discountPercent, discountAmount: e.discountAmount, discountUntil: iso(e.discountUntil) }];
    }
    history = [...history.filter((h) => h.from < from), { from, priceOverride: terms.priceOverride, discountPercent: terms.discountPercent, discountAmount: terms.discountAmount, discountUntil: terms.discountUntil }];
    const data = {
      priceOverride: terms.priceOverride,
      discountPercent: terms.discountPercent,
      discountAmount: terms.discountAmount,
      discountUntil: terms.discountUntil ? fromISODate(terms.discountUntil) : null,
      discountReason: terms.discountReason,
      termsHistory: history as unknown as Prisma.InputJsonValue,
    };
    await tx.enrollment.update({ where: { id: e.id }, data });
    await audit(tx, {
      centerId: actor.centerId,
      userId: actor.userId,
      entity: "Enrollment",
      entityId: e.id,
      action: "terms",
      before: { priceOverride: e.priceOverride, discountPercent: e.discountPercent, discountAmount: e.discountAmount, discountUntil: e.discountUntil, discountReason: e.discountReason },
      after: { ...terms, from },
    });
    await syncEnrollment(e.id, { tx, userId: actor.userId });
  }, TX);
}

/** Nightly: FROZEN ⇄ ACTIVE by freeze dates. */
/** Nightly: ACTIVE ↔ FROZEN by freeze dates. One enrollment that fails is logged and counted; the rest still run. */
export async function refreshFreezeStatuses(today = todayISO()): Promise<{ changed: number; failed: number }> {
  const open = await db.enrollment.findMany({
    where: { endDate: null, status: { in: ["ACTIVE", "FROZEN"] } },
    include: { freezes: true },
  });
  let changed = 0;
  let failed = 0;
  for (const e of open) {
    const frozen = e.freezes.some((f) => toISODate(f.fromDate) <= today && today <= toISODate(f.toDate));
    const want = frozen ? "FROZEN" : "ACTIVE";
    if (e.status === want) continue;
    try {
      await db.enrollment.update({ where: { id: e.id }, data: { status: want } });
      changed++;
    } catch (err) {
      failed++;
      console.error(`[freezes] enrollment ${e.id}:`, err);
    }
  }
  return { changed, failed };
}
