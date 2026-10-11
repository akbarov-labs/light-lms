// Bot data access: linking chats to people and the read models behind each menu button.
import type { LinkKind } from "@prisma/client";
import { db } from "@/lib/db";
import { addDays, formatDate, fromISODate, toISODate, todayISO, weekdayOf } from "@/lib/dates";
import { formatMoney } from "@/lib/money";
import { esc } from "@/lib/messages";
import { familyAllocation } from "@/lib/services/wallet";
import { loadBillingInput } from "@/lib/billing/sync";
import { computeExpected } from "@/lib/billing/engine";
import { nextPeriodStart, periodContaining } from "@/lib/billing/periods";
import { payLinkForFamily } from "@/lib/payments/links";
import { attendanceMark, fullName } from "@/lib/format";
import type { Locale } from "@/lib/i18n";
import { B } from "./texts";

export interface Linked {
  guardians: number;
  students: number;
  staff: { id: string; role: string; isTeacher: boolean }[];
}

/** Attach this chat to every guardian, student and staff user with that phone (any center). */
export async function linkChat(chatId: string, phone: string, locale: Locale): Promise<Linked> {
  const [guardians, students, staff] = await Promise.all([
    db.guardian.findMany({ where: { phone }, select: { id: true } }),
    db.student.findMany({ where: { phone, status: "ACTIVE" }, select: { id: true } }),
    db.user.findMany({ where: { phone, archivedAt: null }, select: { id: true, role: true, isTeacher: true } }),
  ]);
  const links: { kind: LinkKind; refId: string }[] = [
    ...guardians.map((g) => ({ kind: "GUARDIAN" as const, refId: g.id })),
    ...students.map((s) => ({ kind: "STUDENT" as const, refId: s.id })),
    ...staff.map((u) => ({ kind: "STAFF" as const, refId: u.id })),
  ];
  await db.$transaction(async (tx) => {
    if (guardians.length) await tx.guardian.updateMany({ where: { id: { in: guardians.map((g) => g.id) } }, data: { telegramChatId: chatId } });
    if (students.length) await tx.student.updateMany({ where: { id: { in: students.map((s) => s.id) } }, data: { telegramChatId: chatId } });
    if (staff.length) await tx.user.updateMany({ where: { id: { in: staff.map((s) => s.id) } }, data: { telegramChatId: chatId } });
    for (const l of links) {
      await tx.telegramLink.upsert({
        where: { chatId_kind_refId: { chatId, kind: l.kind, refId: l.refId } },
        create: { chatId, kind: l.kind, refId: l.refId, phone, locale },
        update: { phone, locale },
      });
    }
  });
  return { guardians: guardians.length, students: students.length, staff: staff.map((s) => ({ id: s.id, role: s.role, isTeacher: s.isTeacher || s.role === "TEACHER" })) };
}

export async function chatLocale(chatId: string): Promise<Locale | null> {
  const l = await db.telegramLink.findFirst({ where: { chatId }, select: { locale: true } });
  return l ? (l.locale === "ru" ? "ru" : "uz") : null;
}

export async function setChatLocale(chatId: string, locale: Locale) {
  await db.telegramLink.updateMany({ where: { chatId }, data: { locale } });
  await db.user.updateMany({ where: { telegramChatId: chatId }, data: { locale } });
}

export async function chatRoles(chatId: string) {
  const links = await db.telegramLink.findMany({ where: { chatId } });
  const staffIds = links.filter((l) => l.kind === "STAFF").map((l) => l.refId);
  const staff = await db.user.findMany({ where: { id: { in: staffIds }, archivedAt: null } });
  return {
    family: links.some((l) => l.kind === "GUARDIAN" || l.kind === "STUDENT"),
    teacher: staff.find((s) => s.isTeacher || s.role === "TEACHER") ?? null,
    owner: staff.find((s) => s.role === "OWNER" || s.role === "MANAGER") ?? null,
  };
}

/** Students this chat may see: children of linked guardians' families + linked students. */
export async function chatStudents(chatId: string) {
  const links = await db.telegramLink.findMany({ where: { chatId, kind: { in: ["GUARDIAN", "STUDENT"] } } });
  const guardians = await db.guardian.findMany({ where: { id: { in: links.filter((l) => l.kind === "GUARDIAN").map((l) => l.refId) } }, select: { familyId: true } });
  return db.student.findMany({
    where: {
      status: "ACTIVE",
      OR: [{ familyId: { in: guardians.map((g) => g.familyId) } }, { id: { in: links.filter((l) => l.kind === "STUDENT").map((l) => l.refId) } }],
    },
    include: {
      center: { select: { id: true, name: true, phone: true, paymeMerchantId: true, paymeKey: true } },
      enrollments: { where: { endDate: null }, include: { group: { include: { course: true, teacher: { select: { name: true } }, branch: true, room: true } } } },
    },
    orderBy: { firstName: "asc" },
  });
}

const money = (n: number, l: Locale) => formatMoney(n, l === "ru" ? "сум" : "so'm");

export async function balanceText(chatId: string, l: Locale): Promise<{ text: string; payUrls: { label: string; url: string }[] }> {
  const students = await chatStudents(chatId);
  if (students.length === 0) return { text: B.notLinked[l], payUrls: [] };
  const families = [...new Set(students.map((s) => s.familyId))];
  const lines: string[] = [];
  const payUrls: { label: string; url: string }[] = [];
  for (const familyId of families) {
    const alloc = await familyAllocation(familyId);
    lines.push(`💰 <b>${B.balance[l]}: ${money(alloc.balance, l)}</b>`);
    for (const s of students.filter((x) => x.familyId === familyId)) {
      lines.push(`\n👤 <b>${esc(fullName(s))}</b>`);
      for (const e of s.enrollments) {
        const eb = alloc.enrollments.get(e.id);
        lines.push(`• ${esc(e.group.name)}: ${B.charged[l]} ${money(eb?.charged ?? 0, l)}, ${B.paid[l]} ${money(eb?.paid ?? 0, l)}${(eb?.debt ?? 0) > 0 ? `, <b>${B.debt[l]} ${money(eb!.debt, l)}</b>` : ""}`);
        if (e.group.course.pricingType === "SUBSCRIPTION" && e.activatedAt) {
          const anchor = e.group.course.renewal === "CALENDAR" ? 1 : e.group.course.renewal === "GROUP_START" ? Number(toISODate(e.group.startDate).slice(8)) : Number(toISODate(e.activatedAt).slice(8));
          const next = nextPeriodStart(periodContaining(todayISO(), anchor).start, anchor);
          const { input } = await loadBillingInput(db, e.id, next);
          const unit = computeExpected(input).find((u) => u.start === next);
          if (unit) lines.push(`  ${B.nextCharge[l]}: ${formatDate(next)} — ${money(unit.amount, l)}`);
        }
      }
    }
    if (alloc.totalDebt > 0) {
      const url = await payLinkForFamily(familyId);
      if (url) payUrls.push({ label: `${B.pay[l]} ${money(alloc.balance < 0 ? -alloc.balance : alloc.totalDebt, l)}`, url });
    }
  }
  return { text: lines.join("\n"), payUrls };
}

export async function scheduleText(chatId: string, l: Locale): Promise<string> {
  const students = await chatStudents(chatId);
  if (students.length === 0) return B.notLinked[l];
  const today = todayISO();
  const out: string[] = [`📅 <b>${B.schedule[l]}</b>`];
  for (const s of students) {
    const lessons = await db.lesson.findMany({
      where: { groupId: { in: s.enrollments.map((e) => e.groupId) }, date: { gte: fromISODate(today), lte: fromISODate(addDays(today, 6)) }, status: { not: "CANCELLED" } },
      include: { group: { select: { name: true } }, room: { select: { name: true } }, teacher: { select: { name: true } } },
      orderBy: [{ date: "asc" }, { startTime: "asc" }],
    });
    out.push(`\n👤 <b>${esc(fullName(s))}</b>`);
    if (lessons.length === 0) out.push(`— ${B.none[l]}`);
    for (const x of lessons) {
      const d = toISODate(x.date);
      out.push(`${B.days[l][weekdayOf(d) - 1]} ${formatDate(d).slice(0, 5)} ${x.startTime} · ${esc(x.group.name)}${x.room ? ` · ${esc(x.room.name)}` : ""} · ${esc(x.teacher.name)}`);
    }
  }
  return out.join("\n");
}

export async function attendanceText(chatId: string, l: Locale): Promise<string> {
  const students = await chatStudents(chatId);
  if (students.length === 0) return B.notLinked[l];
  const from = addDays(todayISO(), -30);
  const out: string[] = [`✅ <b>${B.attendance[l]}</b> (30)`];
  for (const s of students) {
    const rows = await db.attendance.findMany({
      where: { studentId: s.id, lesson: { date: { gte: fromISODate(from) } } },
      include: { lesson: { select: { date: true, group: { select: { name: true } } } } },
      orderBy: { lesson: { date: "desc" } },
    });
    const present = rows.filter((r) => r.status === "PRESENT" || r.status === "LATE").length;
    out.push(`\n👤 <b>${esc(fullName(s))}</b> — ${present}/${rows.length}`);
    for (const r of rows.slice(0, 15)) out.push(`${formatDate(toISODate(r.lesson.date)).slice(0, 5)} ${attendanceMark[r.status]}${r.grade !== null ? ` (${r.grade})` : ""} ${esc(r.lesson.group.name)}`);
  }
  return out.join("\n");
}

export async function paymentsText(chatId: string, l: Locale): Promise<string> {
  const students = await chatStudents(chatId);
  if (students.length === 0) return B.notLinked[l];
  const rows = await db.ledgerEntry.findMany({
    where: { familyId: { in: [...new Set(students.map((s) => s.familyId))] }, type: "PAYMENT" },
    include: { reversedBy: { select: { id: true } } },
    orderBy: { date: "desc" },
    take: 10,
  });
  if (rows.length === 0) return `🧾 ${B.none[l]}`;
  return [`🧾 <b>${B.payments[l]}</b>`, ...rows.map((r) => `${formatDate(toISODate(r.date))} — ${money(r.amount, l)}${r.method ? ` (${r.method})` : ""}${r.reversedBy ? " ✕" : ""}`)].join("\n");
}

export async function centerText(chatId: string, l: Locale): Promise<string> {
  const students = await chatStudents(chatId);
  if (students.length === 0) return B.notLinked[l];
  const out: string[] = [];
  const seen = new Set<string>();
  for (const s of students) {
    if (!seen.has(s.center.id)) {
      seen.add(s.center.id);
      out.push(`ℹ️ <b>${esc(s.center.name)}</b>${s.center.phone ? `\n☎ +${s.center.phone}` : ""}`);
    }
    for (const e of s.enrollments) {
      const key = e.group.branch.id;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(`🏫 ${esc(e.group.branch.name)}${e.group.branch.address ? `: ${esc(e.group.branch.address)}` : ""}${e.group.branch.phone ? ` · +${e.group.branch.phone}` : ""}`);
    }
  }
  return out.join("\n");
}

export async function teacherLessonsToday(teacherId: string) {
  return db.lesson.findMany({
    where: { teacherId, date: fromISODate(todayISO()), status: { not: "CANCELLED" } },
    include: { group: { select: { name: true, code: true } }, _count: { select: { attendance: true } } },
    orderBy: { startTime: "asc" },
  });
}

export async function teacherWeekText(teacherId: string, l: Locale): Promise<string> {
  const today = todayISO();
  const lessons = await db.lesson.findMany({
    where: { teacherId, date: { gte: fromISODate(today), lte: fromISODate(addDays(today, 6)) }, status: { not: "CANCELLED" } },
    include: { group: { select: { name: true } }, room: { select: { name: true } } },
    orderBy: [{ date: "asc" }, { startTime: "asc" }],
  });
  if (lessons.length === 0) return `📅 ${B.none[l]}`;
  return [`📅 <b>${B.week[l]}</b>`, ...lessons.map((x) => `${B.days[l][weekdayOf(toISODate(x.date)) - 1]} ${formatDate(toISODate(x.date)).slice(0, 5)} ${x.startTime}–${x.endTime} · ${esc(x.group.name)}${x.room ? ` · ${esc(x.room.name)}` : ""}`)].join("\n");
}
