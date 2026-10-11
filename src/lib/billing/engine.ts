// Billing engine — HANDOFF §7. Pure functions: no DB, no clock. `asOf` is passed in.
//
// The engine computes what the family SHOULD owe for every billing unit of one enrollment
// (expected), and `planSync` compares it with what is already posted under each billingKey,
// returning only the difference. Re-running it posts nothing new (idempotent, self-healing).

import { addDays, addMonthsAnchored, parts, type ISODate } from "@/lib/dates";
import { countSlotDates, isChargeable, isFrozenOn, enrollmentCovers } from "./lessons";
import { nextPeriod, periodContaining, periodLabel, type Period } from "./periods";
import type { BillingInput, BillingLesson, EnrollmentTerms, ExpectedUnit, LedgerDelta, PostedEntry } from "./types";

/** Round to the nearest 100 so'm (parent-friendly numbers). */
export function round100(n: number): number {
  return Math.round(n / 100) * 100;
}

/** Course price valid on `at` (price history), else the current course price. */
export function coursePriceAt(course: BillingInput["course"], at: ISODate): number {
  let price = course.price;
  if (course.prices && course.prices.length > 0) {
    const valid = course.prices.filter((p) => p.from <= at).sort((a, b) => a.from.localeCompare(b.from));
    if (valid.length > 0) price = valid[valid.length - 1].price;
  }
  return price;
}

/** Enrollment terms (override + discount) valid for a unit starting on `at`. */
export function termsAt(e: BillingInput["enrollment"], at: ISODate): EnrollmentTerms {
  if (e.terms && e.terms.length > 0) {
    const sorted = [...e.terms].sort((a, b) => a.from.localeCompare(b.from));
    const valid = sorted.filter((t) => t.from <= at);
    const t = valid[valid.length - 1] ?? sorted[0];
    return { priceOverride: t.priceOverride, discountPercent: t.discountPercent, discountAmount: t.discountAmount, discountUntil: t.discountUntil };
  }
  return { priceOverride: e.priceOverride, discountPercent: e.discountPercent, discountAmount: e.discountAmount, discountUntil: e.discountUntil };
}

/** Group price override valid on `at` (history), else the current override. */
function groupOverrideAt(g: BillingInput["group"], at: ISODate): number | null {
  if (g.prices && g.prices.length > 0) {
    const valid = g.prices.filter((p) => p.from <= at).sort((a, b) => a.from.localeCompare(b.from));
    if (valid.length > 0) return valid[valid.length - 1].price;
  }
  return g.priceOverride;
}

/** enrollment override → group override → course price, each as valid on `at`. */
export function basePrice(input: Pick<BillingInput, "course" | "group" | "enrollment">, at: ISODate): number {
  return termsAt(input.enrollment, at).priceOverride ?? groupOverrideAt(input.group, at) ?? coursePriceAt(input.course, at);
}

/**
 * Price of a unit that starts on `unitStart`, with the discount valid then.
 * One discount applies: a percent discount takes precedence over a fixed amount.
 */
export function unitPrice(input: Pick<BillingInput, "course" | "group" | "enrollment">, unitStart: ISODate): number {
  const base = basePrice(input, unitStart);
  const t = termsAt(input.enrollment, unitStart);
  if (t.discountUntil && unitStart > t.discountUntil) return base;
  if (t.discountPercent) return Math.max(0, Math.round((base * (100 - t.discountPercent)) / 100));
  if (t.discountAmount) return Math.max(0, base - t.discountAmount);
  return base;
}

export function groupLabel(input: Pick<BillingInput, "group">): string {
  return `${input.group.name} (#${input.group.code})`;
}

function anchorDay(input: BillingInput): number {
  switch (input.course.renewal) {
    case "GROUP_START":
      return parts(input.group.startDate).d;
    case "STUDENT_START":
      return parts(input.enrollment.activatedAt ?? input.enrollment.startDate).d;
    default:
      return 1;
  }
}

function lessonsIn(lessons: BillingLesson[], p: Period): BillingLesson[] {
  return lessons.filter((l) => l.date >= p.start && l.date <= p.end);
}

/**
 * Lessons the period is priced over: every generated lesson in it (cancelled ones too, so a
 * cancellation lowers this student's share without raising anyone else's), plus the slot dates
 * that fall outside the group's own start/end — so a group that starts or ends mid-month
 * is pro-rated instead of charging a full month for half a month (DECISIONS.md).
 */
export function scheduledInPeriod(input: BillingInput, p: Period): number {
  let n = lessonsIn(input.lessons, p).length;
  const { startDate, endDate, slotWeekdays } = input.group;
  if (p.start < startDate) {
    const to = p.end < startDate ? p.end : prevDay(startDate);
    n += countSlotDates(slotWeekdays, p.start, to, input.holidays);
  }
  if (endDate && p.end > endDate) {
    const from = p.start > endDate ? p.start : nextDay(endDate);
    n += countSlotDates(slotWeekdays, from, p.end, input.holidays);
  }
  return n;
}

const prevDay = (d: ISODate) => addDays(d, -1);
const nextDay = (d: ISODate) => addDays(d, 1);

// ---------------------------------------------------------------- subscription

function subscriptionUnits(input: BillingInput): ExpectedUnit[] {
  const e = input.enrollment;
  const out: ExpectedUnit[] = [];
  if (!e.activatedAt) return out;
  const anchor = anchorDay(input);
  // The period holding the activation day is charged at activation, even if that day is ahead.
  const horizon = e.activatedAt > input.asOf ? e.activatedAt : input.asOf;
  for (
    let p = periodContaining(e.activatedAt, anchor);
    p.start <= horizon && (!e.endDate || p.start <= e.endDate);
    p = nextPeriod(p, anchor)
  ) {
    const scheduled = scheduledInPeriod(input, p);
    const chargeable = lessonsIn(input.lessons, p).filter((l) =>
      isChargeable(l, e, input.settings, input.excusedLessonIds),
    ).length;
    const price = unitPrice(input, p.start);
    let amount = 0;
    if (scheduled > 0) amount = chargeable >= scheduled ? price : round100((price * chargeable) / scheduled);
    out.push({
      key: `sub:${e.id}:${p.start}`,
      enrollmentId: e.id,
      amount,
      start: p.start,
      period: p.start.slice(0, 7),
      description: `${periodLabel(p)} · ${groupLabel(input)} · ${chargeable}/${scheduled} dars`,
    });
  }
  return out;
}

// ---------------------------------------------------------------- package

interface PackageInfo {
  /** Lessons in one package. */
  size: number;
  /** Share of the package price this student pays (< 1 for a late joiner to a whole-course package). */
  ratio: number;
  wholeCourse: boolean;
}

/**
 * Lessons of the whole course from `from` to the group's end: lessons already generated (any status)
 * plus the slot dates after the last generated one — so a schedule change counts the real lessons.
 * Without an end date the count is estimated from the course duration.
 */
export function courseLessonsFrom(input: BillingInput, from: ISODate): number {
  const g = input.group;
  if (!g.endDate) {
    const perWeek = input.course.lessonsPerWeek ?? g.slotWeekdays.length;
    // fixed estimate: the count must not drift as lessons get generated ahead
    const estimate = Math.max(1, Math.round((input.course.durationMonths ?? 1) * perWeek * 4.33));
    const before = input.lessons.filter((l) => l.date >= g.startDate && l.date < from).length;
    return Math.max(1, estimate - before);
  }
  const generated = input.lessons.filter((l) => l.date >= from && l.date <= g.endDate!).length;
  const last = input.lessons.reduce((m, l) => (l.date > m ? l.date : m), "");
  const tailFrom = last && last >= from ? nextDay(last) : from;
  return Math.max(1, generated + countSlotDates(g.slotWeekdays, tailFrom, g.endDate, input.holidays));
}

/** Number of lessons in the whole course. */
export function wholeCourseLessons(input: BillingInput): number {
  return courseLessonsFrom(input, input.group.startDate);
}

function packageInfo(input: BillingInput): PackageInfo {
  if (input.course.packageLessons && input.course.packageLessons > 0) {
    return { size: input.course.packageLessons, ratio: 1, wholeCourse: false };
  }
  // Whole course. A student who joins late buys only the lessons left from their activation day,
  // at the course's per-lesson rate (DECISIONS.md).
  const total = wholeCourseLessons(input);
  const activated = input.enrollment.activatedAt ?? input.group.startDate;
  if (activated > input.group.startDate) {
    const remaining = courseLessonsFrom(input, activated);
    if (remaining > 0 && remaining < total) return { size: remaining, ratio: remaining / total, wholeCourse: true };
  }
  return { size: total, ratio: 1, wholeCourse: true };
}

/** Package price after discount, scaled when the whole-course package was shortened for a late joiner. */
function packagePrice(input: BillingInput, info: PackageInfo, start: ISODate): number {
  return Math.round(unitPrice(input, start) * info.ratio);
}

function installmentAmounts(price: number, n: number): number[] {
  if (n <= 1) return [price];
  const each = Math.floor(price / n);
  return Array.from({ length: n }, (_, j) => (j === n - 1 ? price - each * (n - 1) : each));
}

function packageUnits(input: BillingInput): ExpectedUnit[] {
  const e = input.enrollment;
  const out: ExpectedUnit[] = [];
  if (!e.activatedAt) return out;
  const info = packageInfo(input);
  const N = info.size;
  const chargeable = input.lessons
    .filter((l) => isChargeable(l, e, input.settings, input.excusedLessonIds))
    .sort((a, b) => a.date.localeCompare(b.date));
  const consumedList = chargeable.filter((l) => l.date <= input.asOf);
  const consumed = consumedList.length;
  // a student leaving today is closed today (their last lesson is already counted)
  const closed = !!e.endDate && e.endDate <= input.asOf;
  const inst = Math.max(1, input.course.installments || 1);

  // a whole course is one package, whatever the lesson count turns out to be
  let k = info.wholeCourse ? 1 : Math.max(1, Math.ceil(consumed / N));
  if (!info.wholeCourse && !closed && consumed > 0 && consumed % N === 0 && chargeable.some((l) => l.date > input.asOf)) k += 1;

  for (let i = 1; i <= k; i++) {
    const start = i === 1 ? e.activatedAt : (consumedList[(i - 1) * N - 1]?.date ?? input.asOf);
    const price = packagePrice(input, info, start);
    // Closed enrollment: the last package is charged only for the lessons actually used.
    let owed = price;
    if (closed && i === k) {
      const usedInLast = Math.max(0, consumed - (k - 1) * N);
      owed = Math.min(price, Math.round((price * usedInLast) / N));
    }
    const amounts = installmentAmounts(price, inst);
    let remaining = owed;
    const what = info.wholeCourse ? "Kurs" : N === 1 ? `Dars ${i}` : `Paket ${i}`;
    for (let j = 1; j <= inst; j++) {
      const key = inst > 1 ? `pkg:${e.id}:${i}:${j}` : `pkg:${e.id}:${i}`;
      const due = closed || j === 1 || addMonthsAnchored(start, j - 1) <= input.asOf;
      let amount = 0;
      if (closed) {
        amount = j === inst ? remaining : Math.min(amounts[j - 1], remaining);
        remaining -= amount;
      } else if (due) {
        amount = amounts[j - 1];
      }
      if (!due && !closed) continue;
      out.push({
        key,
        enrollmentId: e.id,
        amount,
        start: j === 1 ? start : addMonthsAnchored(start, j - 1),
        period: null,
        description: `${what} · ${groupLabel(input)} · ${N} dars${inst > 1 ? ` · to'lov ${j}/${inst}` : ""}`,
      });
    }
  }
  return out;
}

// ---------------------------------------------------------------- public API

/** Every billing unit of this enrollment with the amount the family should owe as of `asOf`. */
export function computeExpected(input: BillingInput): ExpectedUnit[] {
  return input.course.pricingType === "SUBSCRIPTION" ? subscriptionUnits(input) : packageUnits(input);
}

/**
 * Compare expected units with ledger entries already posted for this enrollment and return the
 * CHARGE/CREDIT entries that close the gap. Units that disappeared (e.g. enrollment back to trial)
 * are credited in full. Entries without a billingKey (payments etc.) are ignored.
 */
export function planSync(expected: ExpectedUnit[], posted: PostedEntry[]): LedgerDelta[] {
  const postedOwed = new Map<string, number>();
  for (const p of posted) {
    if (!p.billingKey || (p.type !== "CHARGE" && p.type !== "CREDIT")) continue;
    postedOwed.set(p.billingKey, (postedOwed.get(p.billingKey) ?? 0) - p.amount);
  }
  const deltas: LedgerDelta[] = [];
  const seen = new Set<string>();
  for (const u of expected) {
    seen.add(u.key);
    const already = postedOwed.get(u.key) ?? 0;
    const diff = u.amount - already;
    if (diff === 0) continue;
    const isFirst = !postedOwed.has(u.key);
    deltas.push({
      key: u.key,
      type: diff > 0 ? "CHARGE" : "CREDIT",
      amount: -diff,
      period: u.period,
      description: isFirst ? u.description : `Qayta hisob · ${u.description}`,
    });
  }
  for (const [key, owed] of postedOwed) {
    if (seen.has(key) || owed === 0) continue;
    deltas.push({ key, type: owed > 0 ? "CREDIT" : "CHARGE", amount: owed, period: null, description: "Qayta hisob · bekor qilindi" });
  }
  return deltas;
}

export interface LessonValue {
  /** Unrounded per-lesson value in UZS. */
  value: number;
  /** Billing unit the lesson belongs to (for "pay only from collected money"). */
  key: string | null;
  trial: boolean;
}

/**
 * What this lesson is worth for this enrollment — the base of the teacher's % (HANDOFF §8).
 * Returns null when the enrollment does not pay for the lesson. Trial students count only when
 * `payTrial` is on, at the course's base rate.
 */
export function lessonValue(input: BillingInput, lessonId: string, payTrial: boolean): LessonValue | null {
  const lesson = input.lessons.find((l) => l.id === lessonId);
  if (!lesson) return null;
  const e = input.enrollment;

  const inTrial = !e.activatedAt || lesson.date < e.activatedAt;
  if (inTrial) {
    if (!payTrial) return null;
    if (lesson.status === "CANCELLED" || !enrollmentCovers(e, lesson.date) || isFrozenOn(e, lesson.date)) return null;
    if (input.course.pricingType === "SUBSCRIPTION") {
      const p = periodContaining(lesson.date, 1);
      const scheduled = scheduledInPeriod(input, p);
      return scheduled > 0 ? { value: coursePriceAt(input.course, lesson.date) / scheduled, key: null, trial: true } : null;
    }
    const size = input.course.packageLessons || wholeCourseLessons(input);
    return { value: coursePriceAt(input.course, lesson.date) / size, key: null, trial: true };
  }

  if (!isChargeable(lesson, e, input.settings, input.excusedLessonIds)) return null;

  if (input.course.pricingType === "SUBSCRIPTION") {
    const p = periodContaining(lesson.date, anchorDay(input));
    const scheduled = scheduledInPeriod(input, p);
    if (scheduled === 0) return null;
    return { value: unitPrice(input, p.start) / scheduled, key: `sub:${e.id}:${p.start}`, trial: false };
  }

  const info = packageInfo(input);
  const chargeable = input.lessons
    .filter((l) => isChargeable(l, e, input.settings, input.excusedLessonIds))
    .sort((a, b) => a.date.localeCompare(b.date));
  const idx = chargeable.findIndex((l) => l.id === lessonId);
  const pkgIndex = info.wholeCourse ? 1 : Math.floor(idx / info.size) + 1;
  const start = pkgIndex === 1 ? e.activatedAt! : chargeable[(pkgIndex - 1) * info.size - 1].date;
  const price = packagePrice(input, info, start);
  const inst = Math.max(1, input.course.installments || 1);
  return { value: price / info.size, key: inst > 1 ? `pkg:${e.id}:${pkgIndex}:1` : `pkg:${e.id}:${pkgIndex}`, trial: false };
}
