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

/** Course.priceHistory JSON → [{from, price}], ignoring malformed rows. */
export function parsePriceHistory(raw: unknown): { from: ISODate; price: number }[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((r): r is { from: string; price: number } => !!r && typeof r.from === "string" && Number.isInteger(r.price))
    .map((r) => ({ from: r.from, price: r.price }));
}

type GroupWithCourse = Prisma.GroupGetPayload<{ include: { course: true; slots: true } }>;
type EnrollmentWithFreezes = Prisma.EnrollmentGetPayload<{ include: { freezes: true } }>;

/** Assemble the pure engine input from rows already loaded. */
export function buildInput(p: {
  group: GroupWithCourse;
  enrollment: EnrollmentWithFreezes;
  lessons: { id: string; date: Date; status: "SCHEDULED" | "HELD" | "CANCELLED" }[];
  holidays: Set<ISODate>;
  excusedLessonIds: Set<string>;
  excusedAbsenceCredit: boolean;
  asOf: ISODate;
}): BillingInput {
  const { group: g, enrollment } = p;
  return {
    course: {
      name: g.course.name,
      pricingType: g.course.pricingType,
      price: g.course.price,
      renewal: g.course.renewal,
      packageLessons: g.course.packageLessons,
      installments: g.course.installments,
      durationMonths: g.course.durationMonths,
      lessonsPerWeek: g.course.lessonsPerWeek,
      prices: parsePriceHistory(g.course.priceHistory),
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
    lessons: p.lessons.map((l) => ({ id: l.id, date: toISODate(l.date), status: l.status })),
    excusedLessonIds: p.excusedLessonIds,
    holidays: p.holidays,
    settings: { excusedAbsenceCredit: p.excusedAbsenceCredit },
    asOf: p.asOf,
  };
}

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
  const input = buildInput({
    group: g,
    enrollment,
    lessons,
    holidays: new Set(holidays.map((h) => toISODate(h.date))),
    excusedLessonIds: new Set(excused.map((a) => a.lessonId)),
    excusedAbsenceCredit: settings.excusedAbsenceCredit,
    asOf,
  });
  return { input, enrollment };
}

/** Billing inputs for every enrollment of the given groups (one query per table). */
export async function loadGroupInputs(groupIds: string[], asOf: ISODate, tx: Tx = db) {
  const out = new Map<string, { input: BillingInput; studentName: string; familyId: string }[]>();
  if (groupIds.length === 0) return out;
  const groups = await tx.group.findMany({
    where: { id: { in: groupIds } },
    include: { course: true, slots: true, center: { select: { settings: true } }, enrollments: { include: { freezes: true, student: { select: { firstName: true, lastName: true, familyId: true } } } } },
  });
  const centerIds = [...new Set(groups.map((g) => g.centerId))];
  const [lessons, holidays, excused] = await Promise.all([
    tx.lesson.findMany({ where: { groupId: { in: groupIds } }, select: { id: true, date: true, status: true, groupId: true }, orderBy: { date: "asc" } }),
    tx.holiday.findMany({ where: { centerId: { in: centerIds } }, select: { date: true, centerId: true } }),
    tx.attendance.findMany({ where: { status: "EXCUSED", lesson: { groupId: { in: groupIds } } }, select: { lessonId: true, enrollmentId: true } }),
  ]);
  for (const g of groups) {
    const settings = readSettings(g.center.settings);
    const gl = lessons.filter((l) => l.groupId === g.id);
    const hs = new Set(holidays.filter((h) => h.centerId === g.centerId).map((h) => toISODate(h.date)));
    out.set(
      g.id,
      g.enrollments.map((e) => ({
        input: buildInput({
          group: g,
          enrollment: e,
          lessons: gl,
          holidays: hs,
          excusedLessonIds: new Set(excused.filter((x) => x.enrollmentId === e.id).map((x) => x.lessonId)),
          excusedAbsenceCredit: settings.excusedAbsenceCredit,
          asOf,
        }),
        studentName: `${e.student.lastName} ${e.student.firstName}`,
        familyId: e.student.familyId,
      })),
    );
  }
  return out;
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
