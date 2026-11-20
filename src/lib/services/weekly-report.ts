// Weekly report to families (settings.parentReports): for each student, the week's lessons (came / missed)
// and homework results (first-check score, late, not answered). Built only from what the center recorded;
// a student with no lesson and no homework that week gets nothing. Sent once per student per week.
import { db } from "@/lib/db";
import { addDays, formatDate, fromISODate, toISODate, todayISO, weekdayOf, type ISODate } from "@/lib/dates";
import { readSettings } from "@/lib/settings";
import { notifyFamily } from "@/lib/notify";
import { checkAnswers } from "@/lib/homework/grade";
import { esc } from "@/lib/messages";
import type { Locale } from "@/lib/i18n";

export interface WeekLine {
  date: ISODate;
  group: string;
}

export interface StudentWeek {
  student: string;
  came: number;
  lessons: number;
  missed: WeekLine[];
  homework: (WeekLine & { correct: number; total: number; answered: boolean })[];
}

const m = (l: Locale, uz: string, ru: string) => (l === "ru" ? ru : uz);

export function weeklyText(l: Locale, p: { center: string; from: ISODate; to: ISODate; week: StudentWeek }): string {
  const w = p.week;
  const lines = [
    `🗓 <b>${esc(p.center)}</b> — ${m(l, "haftalik hisobot", "отчёт за неделю")} (${formatDate(p.from)}–${formatDate(p.to)})`,
    `👤 <b>${esc(w.student)}</b>`,
  ];
  if (w.lessons) {
    lines.push(`${m(l, "Darslar", "Уроки")}: ${m(l, `${w.lessons} tadan ${w.came} tasiga keldi`, `пришёл(а) на ${w.came} из ${w.lessons}`)}`);
    for (const x of w.missed) lines.push(`  ✗ ${formatDate(x.date)} ${esc(x.group)} — ${m(l, "kelmadi", "не был(а)")}`);
  }
  if (w.homework.length) {
    lines.push(`${m(l, "Uy vazifasi", "Домашнее задание")}:`);
    for (const h of w.homework) {
      const result = h.answered ? `${h.correct}/${h.total}` : m(l, "topshirilmadi", "не сдано");
      lines.push(`  • ${formatDate(h.date)} ${esc(h.group)}: ${result}`);
    }
  }
  return lines.join("\n");
}

/** One student's week, [from, to] inclusive. */
export async function studentWeek(studentId: string, from: ISODate, to: ISODate): Promise<StudentWeek | null> {
  const s = await db.student.findUnique({
    where: { id: studentId },
    select: {
      firstName: true,
      lastName: true,
      enrollments: { where: { OR: [{ endDate: null }, { endDate: { gte: fromISODate(from) } }] }, select: { groupId: true, startDate: true } },
    },
  });
  if (!s) return null;
  const groupIds = [...new Set(s.enrollments.map((e) => e.groupId))];
  const range = { gte: fromISODate(from), lte: fromISODate(to) };
  const [marks, homeworks] = await Promise.all([
    db.attendance.findMany({ where: { studentId, lesson: { date: range, groupId: { in: groupIds } } }, select: { status: true, lesson: { select: { date: true, group: { select: { name: true } } } } }, orderBy: { lesson: { date: "asc" } } }),
    db.homework.findMany({
      where: { groupId: { in: groupIds }, lesson: { date: range } },
      select: { answers: true, lesson: { select: { date: true } }, group: { select: { name: true } }, submissions: { where: { studentId }, select: { firstAnswers: true, answers: true, checks: true } } },
      orderBy: { lesson: { date: "asc" } },
    }),
  ]);
  const came = marks.filter((x) => x.status === "PRESENT" || x.status === "LATE").length;
  const missed = marks.filter((x) => x.status === "ABSENT").map((x) => ({ date: toISODate(x.lesson.date), group: x.lesson.group.name }));
  const homework = homeworks
    .filter((h) => h.answers.length > 0)
    .map((h) => {
      const sub = h.submissions[0];
      // the first check is what the class report uses too: later tries do not hide mistakes
      const given = sub ? (sub.checks > 0 && sub.firstAnswers.length ? sub.firstAnswers : sub.answers) : [];
      const answered = given.some((a) => a.trim() !== "");
      const r = checkAnswers(h.answers, given);
      return { date: toISODate(h.lesson.date), group: h.group.name, correct: r.correct, total: r.total, answered };
    });
  if (!marks.length && !homework.length) return null;
  return { student: `${s.firstName} ${s.lastName}`, came, lessons: marks.length, missed, homework };
}

/**
 * Hourly: centers whose weekly report is on and whose weekday and hour it is send last 7 days' report to
 * every student's family chats (parents and the student). Without `hour` it runs for every center whose
 * weekday it is (manual run). Idempotent through the dedupe key.
 */
export async function weeklyParentReports(today: ISODate = todayISO(), hour?: number): Promise<{ centers: number; sent: number; failed: number }> {
  const centers = await db.center.findMany({ where: { disabledAt: null }, select: { id: true, name: true, settings: true } });
  const from = addDays(today, -6);
  let sent = 0;
  let failed = 0;
  let due = 0;
  for (const c of centers) {
    const s = readSettings(c.settings).parentReports;
    if (!s.weekly || weekdayOf(today) !== s.weekday || (hour !== undefined && hour !== s.hour)) continue;
    due++;
    const students = await db.student.findMany({
      where: { centerId: c.id, status: "ACTIVE", enrollments: { some: { OR: [{ endDate: null }, { endDate: { gte: fromISODate(from) } }] } } },
      select: { id: true, familyId: true },
    });
    for (const st of students) {
      try {
        const week = await studentWeek(st.id, from, today);
        if (!week) continue;
        sent += await db.$transaction((tx) =>
          notifyFamily(tx, { centerId: c.id, familyId: st.familyId, studentId: st.id, event: "reportCard", text: (l) => weeklyText(l, { center: c.name, from, to: today, week }), dedupeKey: `weekly:${st.id}:${today}` }),
        );
      } catch (e) {
        failed++;
        console.error(`weekly report ${st.id}:`, e instanceof Error ? e.message : e);
      }
    }
  }
  return { centers: due, sent, failed };
}
