import type { ISODate } from "@/lib/dates";

export type PricingType = "SUBSCRIPTION" | "PACKAGE";
export type Renewal = "CALENDAR" | "GROUP_START" | "STUDENT_START";
export type LessonStatus = "SCHEDULED" | "HELD" | "CANCELLED";
export type EnrollmentStatus = "TRIAL" | "ACTIVE" | "FROZEN" | "LEFT" | "TRANSFERRED";

export interface BillingCourse {
  name: string;
  pricingType: PricingType;
  price: number;
  renewal: Renewal;
  /** Package size; null = the whole course (all lessons of the group). */
  packageLessons: number | null;
  installments: number;
  durationMonths: number | null;
  lessonsPerWeek: number | null;
  /** Price changes: each price applies from its date. Empty = `price` always. */
  prices?: { from: ISODate; price: number }[];
}

export interface BillingGroup {
  code: number;
  name: string;
  startDate: ISODate;
  endDate: ISODate | null;
  priceOverride: number | null;
  /** Group price override changes; each applies from its date (price null = course price). Empty = priceOverride always. */
  prices?: { from: ISODate; price: number | null }[];
  /** Weekdays (1=Mon..7=Sun) of the group's weekly slots, one entry per slot. */
  slotWeekdays: number[];
  /**
   * Lessons are still being generated ahead (status ACTIVE/PLANNED). When false, slot dates past
   * the last generated lesson are not lessons-to-come. Default true.
   */
  generating?: boolean;
}

export interface BillingFreeze {
  from: ISODate;
  to: ISODate;
}

export interface EnrollmentTerms {
  priceOverride: number | null;
  discountPercent: number | null;
  discountAmount: number | null;
  discountUntil: ISODate | null;
}

export interface BillingEnrollment {
  id: string;
  status: EnrollmentStatus;
  startDate: ISODate;
  endDate: ISODate | null;
  activatedAt: ISODate | null;
  priceOverride: number | null;
  discountPercent: number | null;
  discountAmount: number | null;
  discountUntil: ISODate | null;
  freezes: BillingFreeze[];
  /** Terms changes: each set applies to units starting on/after `from`. Empty = the fields above always. */
  terms?: (EnrollmentTerms & { from: ISODate })[];
}

export interface BillingLesson {
  id: string;
  date: ISODate;
  status: LessonStatus;
  /** The slot date a rescheduled lesson came from (Lesson.origDate); null/absent when it sits on its slot. */
  origDate?: ISODate | null;
}

export interface BillingSettings {
  excusedAbsenceCredit: boolean;
}

export interface BillingInput {
  course: BillingCourse;
  group: BillingGroup;
  enrollment: BillingEnrollment;
  /** Every generated lesson of the group (any status). */
  lessons: BillingLesson[];
  /** Lesson ids where this student's attendance is EXCUSED. */
  excusedLessonIds: Set<string>;
  holidays: Set<ISODate>;
  settings: BillingSettings;
  asOf: ISODate;
}

/** What the family should owe for one billing unit (subscription period, package or installment). */
export interface ExpectedUnit {
  key: string;
  enrollmentId: string;
  /** Owed amount, positive UZS. */
  amount: number;
  start: ISODate;
  /** When the money is due (prepaid): the unit start, or the activation day when that is later. */
  due: ISODate;
  period: string | null;
  description: string;
}

export interface PostedEntry {
  billingKey: string | null;
  type: "CHARGE" | "CREDIT" | "PAYMENT" | "REFUND" | "REVERSAL";
  /** Signed from the family's point of view (charge negative). */
  amount: number;
}

export interface LedgerDelta {
  key: string;
  type: "CHARGE" | "CREDIT";
  /** Signed from the family's point of view: CHARGE negative, CREDIT positive. */
  amount: number;
  /** Due date of the unit (null for a unit that disappeared). The entry is dated max(asOf, due). */
  due: ISODate | null;
  period: string | null;
  description: string;
}
