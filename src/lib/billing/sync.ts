// DB side of the billing engine: load an enrollment, compute expected units, post the deltas.
import type { Prisma } from "@prisma/client";
import { db, type Tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { fromISODate, toISODate, todayISO, type ISODate } from "@/lib/dates";
import { readSettings } from "@/lib/settings";
import { computeExpected, planSync } from "./engine";
import type { BillingInput, LedgerDelta } from "./types";

const enrollmentInclude = {
  freezes: true,
  student: { select: { id: true, familyId: true, centerId: true } },
  group: {
    include: {
      course: true,
      slots: true,
      center: { select: { id: true, settings: true } },
    },
  },
} satisfies Prisma.EnrollmentInclude;

export type EnrollmentForBilling = Prisma.EnrollmentGetPayload<{ include: typeof enrollmentInclude }>;

const d = (v: Date | null | undefined): ISODate | null => (v ? toISODate(v) : null);

/** Build the pure engine input for one enrollment. */
export async function loadBillingInput(tx: Tx, enrollmentId: string, asOf: ISODate): Promise<{ input: BillingInput; enrollment: EnrollmentForBilling }> {
  const enrollment = await tx.enrollment.findUniqueOrThrow({ where: { id: enrollmentId }, include: enrollmentInclude });
  const g = enrollment.group;
  const settings = readSettings(g.center.settings);
  const [lessons, holidays, excused] = await Promise.all([
    tx.lesson.findMany({ where: { groupId: g.id }, select: { id: true, date: true, status: true }, orderBy: { date: "asc" } }),
    tx.holiday.findMany({ where: { centerId: g.centerId }, select: { date: true } }),
    settings.excusedAbsenceCredit
      ? tx.attendance.findMany({ where: { enrollmentId, status: "EXCUSED" }, select: { lessonId: true } })
      : Promise.resolve([] as { lessonId: string }[]),
  ]);
  const input: BillingInput = {
    course: {
      name: g.course.name,
      pricingType: g.course.pricingType,
      price: g.course.price,
      renewal: g.course.renewal,
      packageLessons: g.course.packageLessons,
      installments: g.course.installments,
      durationMonths: g.course.durationMonths,
      lessonsPerWeek: g.course.lessonsPerWeek,
    },
    group: {
      code: g.code,
      name: g.name,
      startDate: toISODate(g.startDate),
      endDate: d(g.endDate),
      priceOverride: g.priceOverride,
      slotWeekdays: g.slots.map((s) => s.weekday),
    },
    enrollment: {
      id: enrollment.id,
      status: enrollment.status,
      startDate: toISODate(enrollment.startDate),
      endDate: d(enrollment.endDate),
      activatedAt: d(enrollment.activatedAt),
      priceOverride: enrollment.priceOverride,
      discountPercent: enrollment.discountPercent,
      discountAmount: enrollment.discountAmount,
      discountUntil: d(enrollment.discountUntil),
      freezes: enrollment.freezes.map((f) => ({ from: toISODate(f.fromDate), to: toISODate(f.toDate) })),
    },
    lessons: lessons.map((l) => ({ id: l.id, date: toISODate(l.date), status: l.status })),
    excusedLessonIds: new Set(excused.map((a) => a.lessonId)),
    holidays: new Set(holidays.map((h) => toISODate(h.date))),
    settings: { excusedAbsenceCredit: settings.excusedAbsenceCredit },
    asOf,
  };
  return { input, enrollment };
}

async function syncInTx(tx: Tx, enrollmentId: string, asOf: ISODate, userId: string | null): Promise<LedgerDelta[]> {
  // Serialize syncs of the same enrollment so two requests can't post the same delta twice.
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${enrollmentId}))`;
  const { input, enrollment } = await loadBillingInput(tx, enrollmentId, asOf);
  const posted = await tx.ledgerEntry.findMany({
    where: { enrollmentId, type: { in: ["CHARGE", "CREDIT"] }, billingKey: { not: null } },
    select: { billingKey: true, type: true, amount: true },
  });
  const deltas = planSync(computeExpected(input), posted);
  if (deltas.length === 0) return deltas;
  await tx.ledgerEntry.createMany({
    data: deltas.map((x) => ({
      centerId: enrollment.student.centerId,
      familyId: enrollment.student.familyId,
      studentId: enrollment.studentId,
      enrollmentId,
      type: x.type,
      amount: x.amount,
      method: "SYSTEM" as const,
      billingKey: x.key,
      period: x.period,
      description: x.description,
      date: fromISODate(asOf),
      createdById: userId,
    })),
  });
  await audit(tx, {
    centerId: enrollment.student.centerId,
    userId,
    entity: "Enrollment",
    entityId: enrollmentId,
    action: "billing.sync",
    after: { asOf, deltas },
  });
  return deltas;
}

export interface SyncOptions {
  asOf?: ISODate;
  userId?: string | null;
  tx?: Tx;
}

/** Post the CHARGE/CREDIT entries that bring this enrollment's ledger to its expected state. */
export async function syncEnrollment(enrollmentId: string, opts: SyncOptions = {}): Promise<LedgerDelta[]> {
  const asOf = opts.asOf ?? todayISO();
  if (opts.tx) return syncInTx(opts.tx, enrollmentId, asOf, opts.userId ?? null);
  return db.$transaction((tx) => syncInTx(tx, enrollmentId, asOf, opts.userId ?? null), { timeout: 30_000 });
}

/** Sync every enrollment of a group that can still be billed (after lesson changes, price edits…). */
export async function syncGroup(groupId: string, opts: SyncOptions = {}): Promise<number> {
  const client = opts.tx ?? db;
  const enrollments = await client.enrollment.findMany({ where: { groupId }, select: { id: true } });
  let n = 0;
  for (const e of enrollments) n += (await syncEnrollment(e.id, opts)).length;
  return n;
}

export async function syncStudent(studentId: string, opts: SyncOptions = {}): Promise<number> {
  const client = opts.tx ?? db;
  const enrollments = await client.enrollment.findMany({ where: { studentId }, select: { id: true } });
  let n = 0;
  for (const e of enrollments) n += (await syncEnrollment(e.id, opts)).length;
  return n;
}
