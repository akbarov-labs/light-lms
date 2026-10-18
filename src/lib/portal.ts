// What a Telegram chat sees in the Mini App: the same people and rules as the bot (chatStudents / chatRoles),
// as structured data instead of text. Read-only.
import { db } from "@/lib/db";
import { addDays, fromISODate, toISODate, todayISO } from "@/lib/dates";
import { familyAllocation } from "@/lib/services/wallet";
import { loadBillingInput } from "@/lib/billing/sync";
import { computeExpected } from "@/lib/billing/engine";
import { nextPeriodStart, periodContaining } from "@/lib/billing/periods";
import { payLinkForFamily } from "@/lib/payments/links";
import { fullName } from "@/lib/format";
import { appUrl } from "@/lib/env";
import { cardUrl, type ReportCardData } from "@/lib/services/report-cards";
import { verifyUrl } from "@/lib/services/exams";
import { chatRoles, chatStudents } from "@/worker/bot/data";

export interface PortalGroup {
  enrollmentId: string;
  name: string;
  code: number;
  status: string;
  teacher: string;
  branch: string;
  address: string | null;
  charged: number;
  paid: number;
  debt: number;
  next: { date: string; amount: number } | null;
}

export interface PortalData {
  today: string;
  family: boolean;
  teacher: { name: string; url: string; lessons: { start: string; end: string; group: string; marked: boolean; cancelled: boolean }[] } | null;
  adminUrl: string | null;
  families: { id: string; center: string; centerPhone: string | null; balance: number; debt: number; payUrl: string | null; students: { id: string; name: string; groups: PortalGroup[] }[] }[];
  schedule: { date: string; start: string; end: string; student: string; group: string; room: string | null; teacher: string }[];
  attendance: { date: string; student: string; group: string; status: string; grade: number | null }[];
  reportCards: { student: string; group: string; month: string; url: string; attendancePct: number | null; gradeAvg: number | null; rating: string | null }[];
  certificates: { student: string; title: string; level: string | null; number: string; issuedAt: string; url: string; revoked: boolean }[];
  payments: { date: string; amount: number; method: string | null; reversed: boolean }[];
}

async function nextCharge(e: { id: string; activatedAt: Date | null; group: { startDate: Date; course: { pricingType: string; renewal: string } } }, today: string) {
  if (e.group.course.pricingType !== "SUBSCRIPTION" || !e.activatedAt) return null;
  const anchor = e.group.course.renewal === "CALENDAR" ? 1 : e.group.course.renewal === "GROUP_START" ? Number(toISODate(e.group.startDate).slice(8)) : Number(toISODate(e.activatedAt).slice(8));
  const next = nextPeriodStart(periodContaining(today, anchor).start, anchor);
  const { input } = await loadBillingInput(db, e.id, next);
  const unit = computeExpected(input).find((u) => u.start === next);
  return unit ? { date: next, amount: unit.amount } : null;
}

export async function portalFor(chatId: string): Promise<PortalData> {
  const today = todayISO();
  const [roles, students] = await Promise.all([chatRoles(chatId), chatStudents(chatId)]);
  const data: PortalData = { today, family: students.length > 0, teacher: null, adminUrl: null, families: [], schedule: [], attendance: [], reportCards: [], certificates: [], payments: [] };

  if (roles.teacher) {
    const lessons = await db.lesson.findMany({
      where: { teacherId: roles.teacher.id, date: fromISODate(today) },
      include: { group: { select: { name: true } }, _count: { select: { attendance: true } } },
      orderBy: { startTime: "asc" },
    });
    data.teacher = { name: roles.teacher.name, url: `${appUrl()}/t`, lessons: lessons.map((l) => ({ start: l.startTime, end: l.endTime, group: l.group.name, marked: l._count.attendance > 0, cancelled: l.status === "CANCELLED" })) };
  }
  if (roles.owner) data.adminUrl = appUrl();
  if (students.length === 0) return data;

  const familyIds = [...new Set(students.map((s) => s.familyId))];
  for (const familyId of familyIds) {
    const alloc = await familyAllocation(familyId);
    const mine = students.filter((s) => s.familyId === familyId);
    const center = mine[0].center;
    const fam: PortalData["families"][number] = { id: familyId, center: center.name, centerPhone: center.phone, balance: alloc.balance, debt: alloc.totalDebt, payUrl: null, students: [] };
    for (const s of mine) {
      const groups: PortalGroup[] = [];
      for (const e of s.enrollments) {
        const eb = alloc.enrollments.get(e.id);
        groups.push({
          enrollmentId: e.id,
          name: e.group.name,
          code: e.group.code,
          status: e.status,
          teacher: e.group.teacher.name,
          branch: e.group.branch.name,
          address: e.group.branch.address,
          charged: eb?.charged ?? 0,
          paid: eb?.paid ?? 0,
          debt: eb?.debt ?? 0,
          next: await nextCharge(e, today),
        });
      }
      fam.students.push({ id: s.id, name: fullName(s), groups });
    }
    if (alloc.totalDebt > 0 || alloc.balance < 0) fam.payUrl = await payLinkForFamily(familyId);
    data.families.push(fam);
  }

  const name = new Map(students.map((s) => [s.id, fullName(s)]));
  const groupIds = [...new Set(students.flatMap((s) => s.enrollments.map((e) => e.groupId)))];
  const studentIds = students.map((s) => s.id);
  const [lessons, marks, cards, certs, pays] = await Promise.all([
    db.lesson.findMany({
      where: { groupId: { in: groupIds }, date: { gte: fromISODate(today), lte: fromISODate(addDays(today, 6)) }, status: { not: "CANCELLED" } },
      include: { group: { select: { name: true } }, room: { select: { name: true } }, teacher: { select: { name: true } } },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
      take: 100,
    }),
    db.attendance.findMany({
      where: { studentId: { in: studentIds }, lesson: { date: { gte: fromISODate(addDays(today, -30)) } } },
      include: { lesson: { select: { date: true, group: { select: { name: true } } } } },
      orderBy: { lesson: { date: "desc" } },
      take: 120,
    }),
    db.reportCard.findMany({ where: { studentId: { in: studentIds }, status: "SENT" }, orderBy: { month: "desc" }, take: 24 }),
    db.certificate.findMany({ where: { studentId: { in: studentIds } }, orderBy: { issuedAt: "desc" }, take: 24 }),
    db.ledgerEntry.findMany({ where: { familyId: { in: familyIds }, type: "PAYMENT" }, include: { reversedBy: { select: { id: true } } }, orderBy: [{ date: "desc" }, { createdAt: "desc" }], take: 15 }),
  ]);
  // a lesson belongs to every child of this chat enrolled in that group (siblings may share one)
  for (const l of lessons) {
    for (const s of students.filter((x) => x.enrollments.some((e) => e.groupId === l.groupId))) {
      data.schedule.push({ date: toISODate(l.date), start: l.startTime, end: l.endTime, student: fullName(s), group: l.group.name, room: l.room?.name ?? null, teacher: l.teacher.name });
    }
  }
  data.attendance = marks.map((a) => ({ date: toISODate(a.lesson.date), student: name.get(a.studentId) ?? "", group: a.lesson.group.name, status: a.status, grade: a.grade }));
  data.reportCards = cards.map((c) => {
    const d = c.data as unknown as ReportCardData | null;
    return { student: name.get(c.studentId) ?? "", group: d?.group ?? "", month: c.month, url: cardUrl(c.token), attendancePct: d?.progress.attendancePct ?? null, gradeAvg: d?.progress.gradeAvg ?? null, rating: d?.progress.rating ?? null };
  });
  data.certificates = certs.map((c) => ({ student: name.get(c.studentId) ?? "", title: c.title, level: c.level, number: c.number, issuedAt: toISODate(c.issuedAt), url: verifyUrl(c.code), revoked: !!c.revokedAt }));
  data.payments = pays.map((p) => ({ date: toISODate(p.date), amount: p.amount, method: p.method, reversed: !!p.reversedBy }));
  return data;
}
