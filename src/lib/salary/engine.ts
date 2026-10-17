// Teacher salary engine — HANDOFF §8. Pure: inputs are lessons + billing inputs, no DB.
import { monthRange, type ISODate } from "@/lib/dates";
import { lessonValue } from "@/lib/billing/engine";
import type { BillingInput } from "@/lib/billing/types";

export type SalaryModel = "PERCENT_EARNED" | "FIXED" | "PER_LESSON" | "BASE_PLUS_PERCENT";

export interface SalaryRule {
  model: SalaryModel;
  percent: number | null;
  fixedAmount: number | null;
  perLesson: number | null;
}

export interface StudentLesson {
  enrollmentId: string;
  studentName: string;
  value: number;
  key: string | null;
  trial: boolean;
  /** Billing unit fully paid (only matters with "pay only from collected money"). */
  paid: boolean;
}

export interface HeldLesson {
  lessonId: string;
  date: ISODate;
  groupId: string;
  groupName: string;
  students: StudentLesson[];
}

export interface Adjustment {
  id?: string;
  amount: number;
  reason: string;
}

export interface SalaryLine {
  groupId: string;
  groupName: string;
  lessonsHeld: number;
  studentLessons: number;
  earnedBase: number;
  amount: number;
}

export interface SalaryResult {
  model: SalaryModel | null;
  base: number;
  lines: SalaryLine[];
  adjustments: Adjustment[];
  adjustmentsTotal: number;
  lessonsHeld: number;
  total: number;
  warnings: string[];
}

export interface LessonRow {
  id: string;
  date: ISODate;
  status: "SCHEDULED" | "HELD" | "CANCELLED";
  teacherId: string;
  groupId: string;
  groupName: string;
}

export interface GroupEnrollment {
  input: BillingInput;
  studentName: string;
}

/**
 * Held lessons of teacher T in month M, each with the students it is paid for.
 * The lesson's ACTUAL teacher counts, so a substitute gets the lesson (and the regular teacher doesn't).
 */
export function collectLessons(p: {
  teacherId: string;
  month: string;
  lessons: LessonRow[];
  enrollmentsByGroup: Map<string, GroupEnrollment[]>;
  payTrial: boolean;
  paidKeys: Set<string>;
}): HeldLesson[] {
  const { start, end } = monthRange(p.month);
  return p.lessons
    .filter((l) => l.teacherId === p.teacherId && l.status === "HELD" && l.date >= start && l.date <= end)
    .sort((a, b) => a.date.localeCompare(b.date))
    .map((l) => {
      const students: StudentLesson[] = [];
      for (const ge of p.enrollmentsByGroup.get(l.groupId) ?? []) {
        const v = lessonValue(ge.input, l.id, p.payTrial);
        if (!v) continue;
        // with installments the lesson's installment AND every earlier one must be paid
        const paid = v.keys.length > 0 && v.keys.every((k) => p.paidKeys.has(k));
        students.push({ enrollmentId: ge.input.enrollment.id, studentName: ge.studentName, value: v.value, key: v.key, trial: v.trial, paid });
      }
      return { lessonId: l.id, date: l.date, groupId: l.groupId, groupName: l.groupName, students };
    });
}

/**
 * Does the fixed/base part apply to this month? Not for a month that starts after the teacher was
 * archived (the month they leave in is still paid in full; no pro-rating).
 */
export function basePayApplies(month: string, archivedOn: ISODate | null | undefined): boolean {
  return !archivedOn || monthRange(month).start <= archivedOn;
}

export function computeSalary(p: {
  rule: SalaryRule | null;
  lessons: HeldLesson[];
  adjustments: Adjustment[];
  payFromCollected: boolean;
  /** With `archivedOn`: no fixed/base pay for months starting after the archive day. */
  month?: string;
  archivedOn?: ISODate | null;
}): SalaryResult {
  const warnings: string[] = [];
  if (!p.rule) warnings.push("noRule");
  const baseApplies = !p.month || basePayApplies(p.month, p.archivedOn);
  if (!baseApplies) warnings.push("archived");
  const model = p.rule?.model ?? null;
  const percent = (p.rule?.percent ?? 0) / 100;
  const byGroup = new Map<string, SalaryLine>();
  for (const l of p.lessons) {
    const line = byGroup.get(l.groupId) ?? { groupId: l.groupId, groupName: l.groupName, lessonsHeld: 0, studentLessons: 0, earnedBase: 0, amount: 0 };
    line.lessonsHeld += 1;
    for (const s of l.students) {
      if (p.payFromCollected && !s.trial && !s.paid) continue;
      line.studentLessons += 1;
      line.earnedBase += s.value;
    }
    byGroup.set(l.groupId, line);
  }
  const lines = [...byGroup.values()].map((line) => {
    let amount = 0;
    if (model === "PERCENT_EARNED" || model === "BASE_PLUS_PERCENT") amount = Math.round(line.earnedBase * percent);
    if (model === "PER_LESSON") amount = (p.rule?.perLesson ?? 0) * line.lessonsHeld;
    return { ...line, earnedBase: Math.round(line.earnedBase), amount };
  });
  const base = baseApplies && (model === "FIXED" || model === "BASE_PLUS_PERCENT") ? (p.rule?.fixedAmount ?? 0) : 0;
  const adjustmentsTotal = p.adjustments.reduce((s, a) => s + a.amount, 0);
  const total = base + lines.reduce((s, l) => s + l.amount, 0) + adjustmentsTotal;
  return { model, base, lines, adjustments: p.adjustments, adjustmentsTotal, lessonsHeld: p.lessons.length, total, warnings };
}
