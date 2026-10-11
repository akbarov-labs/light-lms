// Helpers to build billing inputs in tests (not imported by app code).
import type { ISODate } from "@/lib/dates";
import { computeExpected, planSync } from "./engine";
import { generateLessonDates, type Slot } from "./lessons";
import type { BillingCourse, BillingEnrollment, BillingInput, BillingLesson, PostedEntry } from "./types";

export const MWF: Slot[] = [
  { weekday: 1, startTime: "09:00", endTime: "10:30" },
  { weekday: 3, startTime: "09:00", endTime: "10:30" },
  { weekday: 5, startTime: "09:00", endTime: "10:30" },
];
export const TTS: Slot[] = [
  { weekday: 2, startTime: "14:00", endTime: "15:30" },
  { weekday: 4, startTime: "14:00", endTime: "15:30" },
  { weekday: 6, startTime: "14:00", endTime: "15:30" },
];

export function course(over: Partial<BillingCourse> = {}): BillingCourse {
  return {
    name: "General English A1",
    pricingType: "SUBSCRIPTION",
    price: 600_000,
    renewal: "CALENDAR",
    packageLessons: null,
    installments: 1,
    durationMonths: null,
    lessonsPerWeek: 3,
    ...over,
  };
}

export function enrollment(over: Partial<BillingEnrollment> = {}): BillingEnrollment {
  return {
    id: "e1",
    status: "ACTIVE",
    startDate: "2026-10-01",
    endDate: null,
    activatedAt: "2026-10-01",
    priceOverride: null,
    discountPercent: null,
    discountAmount: null,
    discountUntil: null,
    freezes: [],
    ...over,
  };
}

export function lessons(slots: Slot[], from: ISODate, to: ISODate, holidays = new Set<ISODate>(), prefix = "L"): BillingLesson[] {
  return generateLessonDates(slots, from, to, holidays).map((l) => ({
    id: `${prefix}${l.date}${l.startTime}`,
    date: l.date,
    status: "SCHEDULED" as const,
  }));
}

export interface Scenario {
  slots: Slot[];
  input: BillingInput;
}

export function scenario(opts: {
  slots?: Slot[];
  course?: Partial<BillingCourse>;
  enrollment?: Partial<BillingEnrollment>;
  groupStart?: ISODate;
  groupEnd?: ISODate | null;
  lessonsTo?: ISODate;
  holidays?: ISODate[];
  asOf: ISODate;
  excusedCredit?: boolean;
  groupPrice?: number | null;
}): BillingInput {
  const slots = opts.slots ?? MWF;
  const holidays = new Set(opts.holidays ?? []);
  const groupStart = opts.groupStart ?? "2026-09-01";
  const groupEnd = opts.groupEnd ?? null;
  const to = opts.lessonsTo ?? groupEnd ?? "2027-03-31";
  return {
    course: course(opts.course),
    group: {
      code: 12,
      name: "GE-A1 Morning",
      startDate: groupStart,
      endDate: groupEnd,
      priceOverride: opts.groupPrice ?? null,
      slotWeekdays: slots.map((s) => s.weekday),
    },
    enrollment: enrollment(opts.enrollment),
    lessons: lessons(slots, groupStart, to, holidays),
    excusedLessonIds: new Set(),
    holidays,
    settings: { excusedAbsenceCredit: opts.excusedCredit ?? false },
    asOf: opts.asOf,
  };
}

/** In-memory ledger for one enrollment: run sync and append the deltas, like sync.ts does. */
export class FakeLedger {
  entries: PostedEntry[] = [];
  sync(input: BillingInput): PostedEntry[] {
    const deltas = planSync(computeExpected(input), this.entries);
    const added = deltas.map((d) => ({ billingKey: d.key, type: d.type, amount: d.amount }) as PostedEntry);
    this.entries.push(...added);
    return added;
  }
  /** Total owed (positive) from engine entries. */
  get owed(): number {
    return 0 - this.entries.reduce((s, e) => s + e.amount, 0) || 0;
  }
  owedFor(prefix: string): number {
    return -this.entries.filter((e) => e.billingKey?.startsWith(prefix)).reduce((s, e) => s + e.amount, 0);
  }
}

export function withStatus(input: BillingInput, date: ISODate, status: BillingLesson["status"]): BillingInput {
  return { ...input, lessons: input.lessons.map((l) => (l.date === date ? { ...l, status } : l)) };
}
