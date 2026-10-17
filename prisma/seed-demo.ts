// Demo center (HANDOFF §13). Deterministic: a seeded PRNG drives every choice; dates are relative to
// "today" so the demo always looks current. Billing, payments and salaries go through the real services,
// so the demo data is exactly what the app itself would have produced.
import type { PrismaClient } from "../src/generated/prisma/client";
import bcrypt from "bcryptjs";
import { db } from "../src/lib/db";
import { DEFAULT_PERMS, PERMS } from "../src/lib/perms";
import { addDays, addMonthsAnchored, fromISODate, monthRange, parts, shiftMonth, toISODate, todayISO, type ISODate } from "../src/lib/dates";
import { generateLessons } from "../src/lib/services/lessons";
import { syncEnrollment } from "../src/lib/billing/sync";
import { isFrozenOn } from "../src/lib/billing/lessons";
import { reversePayment, takePayment, refund } from "../src/lib/services/payments";
import { lockPayslip, markPayslipPaid } from "../src/lib/salary/service";
import { familyAllocation } from "../src/lib/services/wallet";

// ------------------------------------------------------------------ deterministic random
function mulberry32(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rnd = mulberry32(20261011);
const pick = <T,>(a: readonly T[]): T => a[Math.floor(rnd() * a.length)];
const chance = (p: number) => rnd() < p;
const int = (lo: number, hi: number) => lo + Math.floor(rnd() * (hi - lo + 1));

const MALE = ["Ali", "Jasur", "Sardor", "Bekzod", "Javohir", "Doniyor", "Aziz", "Otabek", "Sherzod", "Islom", "Abdulloh", "Muhammad", "Shohruh", "Behruz", "Ulug'bek", "Firdavs", "Temur", "Asadbek", "Diyorbek", "Sanjar"];
const FEMALE = ["Madina", "Malika", "Sevara", "Dilnoza", "Zarina", "Nilufar", "Shahzoda", "Mohinur", "Gulnoza", "Kamola", "Sabina", "Mubina", "Laylo", "Odina", "Yasmina", "Feruza", "Nodira", "Barno", "Munisa", "Zuhra"];
const SURNAMES = ["Karimov", "Rahimov", "Tursunov", "Aliyev", "Yusupov", "Saidov", "Ergashev", "Abdullayev", "Rasulov", "Nazarov", "Xolmatov", "Mirzayev", "Qodirov", "Sobirov", "Ismoilov", "Toshmatov", "Usmonov", "Hasanov", "Jo'rayev", "Mahmudov", "Sultonov", "Ahmedov", "Normatov", "Yo'ldoshev", "Bakirov", "Fayzullayev", "Valiyev", "Umarov", "Shukurov", "Hamidov"];
const SOURCES = ["Instagram", "Telegram", "Tanish", "Banner", "Sayt formasi", "Qo'ng'iroq"];
const phone = () => `9989${pick(["0", "1", "3", "4", "5", "7", "8", "9"])}${String(int(1_000_000, 9_999_999))}`;

// ------------------------------------------------------------------ helpers
async function audit(centerId: string, entity: string, entityId: string, action: string, after?: object) {
  await db.auditLog.create({ data: { centerId, entity, entityId, action, ...(after ? { after: JSON.parse(JSON.stringify(after)) } : {}) } });
}

function holidaysFor(years: number[]): { date: ISODate; name: string }[] {
  const list: [string, string][] = [
    ["01-01", "Yangi yil"],
    ["03-08", "Xalqaro xotin-qizlar kuni"],
    ["03-21", "Navro'z"],
    ["05-09", "Xotira va qadrlash kuni"],
    ["09-01", "Mustaqillik kuni"],
    ["10-01", "O'qituvchi va murabbiylar kuni"],
    ["12-08", "Konstitutsiya kuni"],
  ];
  return years.flatMap((y) => list.map(([md, name]) => ({ date: `${y}-${md}`, name })));
}

export async function seedDemo(_client?: PrismaClient) {
  const t0 = Date.now();
  const today = todayISO();
  console.log(`[seed] demo center as of ${today}…`);
  const hash = await bcrypt.hash("demo1234", 10);

  // ---------------------------------------------------------------- center, branches, rooms, holidays
  const center = await db.center.create({
    data: {
      name: "Demo O'quv Markazi",
      slug: "demo",
      phone: "998712000000",
      accentColor: "#2563eb",
      settings: { trialLessons: 1, reminderDaysBefore: 3 },
      plan: "PRO",
      onboarding: { completedAt: new Date().toISOString() },
    },
  });
  const chilonzor = await db.branch.create({ data: { centerId: center.id, name: "Chilonzor", address: "Chilonzor 9-kvartal, 12-uy", phone: "998712000001" } });
  const yunusobod = await db.branch.create({ data: { centerId: center.id, name: "Yunusobod", address: "Yunusobod 4-mavze, 7-uy", phone: "998712000002" } });
  const rooms: Record<string, string> = {};
  for (const b of [chilonzor, yunusobod]) {
    for (const n of ["101", "102", "103"]) {
      const r = await db.room.create({ data: { branchId: b.id, name: `${b.name[0]}-${n}`, capacity: 14 } });
      rooms[r.name] = r.id;
    }
  }
  const y = parts(today).y;
  for (const h of holidaysFor([y - 1, y, y + 1])) await db.holiday.create({ data: { centerId: center.id, date: fromISODate(h.date), name: h.name } });

  // ---------------------------------------------------------------- staff (logins in README)
  const staffDef = [
    { key: "owner", phone: "998901234567", name: "Sardor Akbarov", role: "OWNER", branches: [] as string[] },
    { key: "manager", phone: "998901234568", name: "Dilnoza Rahimova", role: "MANAGER", branches: [chilonzor.id, yunusobod.id] },
    { key: "admin", phone: "998901234569", name: "Malika Tursunova", role: "ADMIN", branches: [chilonzor.id] },
    { key: "cashier", phone: "998901234570", name: "Jasur Kamolov", role: "ADMIN", perms: ["payments.take"], branches: [yunusobod.id] },
    { key: "aziza", phone: "998901234571", name: "Aziza Karimova", role: "TEACHER", branches: [chilonzor.id] },
    { key: "bobur", phone: "998901234572", name: "Bobur Aliyev", role: "TEACHER", branches: [chilonzor.id, yunusobod.id] },
    { key: "nodira", phone: "998901234573", name: "Nodira Saidova", role: "TEACHER", branches: [yunusobod.id] },
    { key: "otabek", phone: "998901234574", name: "Otabek Yusupov", role: "ADMIN", isTeacher: true, branches: [yunusobod.id] },
  ] as const;
  const U: Record<string, string> = {};
  for (const s of staffDef) {
    const u = await db.user.create({
      data: {
        centerId: center.id,
        phone: s.phone,
        name: s.name,
        passwordHash: hash,
        role: s.role,
        isTeacher: s.role === "TEACHER" || ("isTeacher" in s && s.isTeacher),
        perms: s.role === "OWNER" ? [...PERMS] : "perms" in s ? [...s.perms] : DEFAULT_PERMS[s.role],
        branches: { create: s.branches.map((branchId) => ({ branchId })) },
      },
    });
    U[s.key] = u.id;
  }
  const admin = { userId: U.admin, centerId: center.id };
  const cashier = { userId: U.cashier, centerId: center.id };
  const owner = { userId: U.owner, centerId: center.id };

  // ---------------------------------------------------------------- courses
  const C = {
    ge: await db.course.create({ data: { centerId: center.id, name: "General English A1", level: "A1", lessonMinutes: 90, lessonsPerWeek: 3, durationMonths: 3, pricingType: "SUBSCRIPTION", price: 600_000, renewal: "CALENDAR" } }),
    ielts: await db.course.create({ data: { centerId: center.id, name: "IELTS Intensive", level: "B2+", lessonMinutes: 90, lessonsPerWeek: 3, durationMonths: 3, pricingType: "SUBSCRIPTION", price: 900_000, renewal: "STUDENT_START" } }),
    python: await db.course.create({ data: { centerId: center.id, name: "Python Foundation", level: "Boshlang'ich", lessonMinutes: 120, lessonsPerWeek: 2, durationMonths: 4, pricingType: "PACKAGE", price: 2_400_000, packageLessons: null, installments: 4 } }),
    math: await db.course.create({ data: { centerId: center.id, name: "Matematika DTM", level: "Abituriyent", lessonMinutes: 90, lessonsPerWeek: 3, durationMonths: 9, pricingType: "SUBSCRIPTION", price: 500_000, renewal: "GROUP_START" } }),
    indiv: await db.course.create({ data: { centerId: center.id, name: "Individual English", lessonMinutes: 60, lessonsPerWeek: 2, pricingType: "PACKAGE", price: 150_000, packageLessons: 1 } }),
  };

  // ---------------------------------------------------------------- groups (8, started over the last 3 months)
  const MWF = [1, 3, 5];
  const TT = [2, 4];
  const TTS = [2, 4, 6];
  const groupDef = [
    { key: "ge1", name: "GE-A1 ertalab", course: C.ge, teacher: U.aziza, branch: chilonzor.id, room: "C-101", days: MWF, start: "09:00", end: "10:30", ago: 92 },
    { key: "ge2", name: "GE-A1 kechki", course: C.ge, teacher: U.bobur, branch: chilonzor.id, room: "C-102", days: MWF, start: "18:00", end: "19:30", ago: 75 },
    { key: "ielts", name: "IELTS 7.0", course: C.ielts, teacher: U.nodira, branch: yunusobod.id, room: "Y-101", days: TTS, start: "15:00", end: "16:30", ago: 64 },
    { key: "math1", name: "DTM Matematika", course: C.math, teacher: U.otabek, branch: yunusobod.id, room: "Y-102", days: MWF, start: "14:00", end: "15:30", ago: 58 },
    { key: "py", name: "Python 1-oqim", course: C.python, teacher: U.bobur, branch: yunusobod.id, room: "Y-103", days: TT, start: "18:00", end: "20:00", ago: 52, months: 4 },
    { key: "indiv", name: "Individual: Aziza", course: C.indiv, teacher: U.aziza, branch: chilonzor.id, room: "C-103", days: TT, start: "11:00", end: "12:00", ago: 45 },
    { key: "ge3", name: "GE-A1 Yunusobod", course: C.ge, teacher: U.nodira, branch: yunusobod.id, room: "Y-101", days: MWF, start: "10:00", end: "11:30", ago: 33 },
    { key: "math2", name: "DTM Matematika Chilonzor", course: C.math, teacher: U.aziza, branch: chilonzor.id, room: "C-102", days: TTS, start: "09:00", end: "10:30", ago: 21 },
  ];
  const G: Record<string, { id: string; start: ISODate; courseId: string; branch: string; days: number[] }> = {};
  for (const [i, g] of groupDef.entries()) {
    const start = addDays(today, -g.ago);
    const end = g.months ? addDays(addMonthsAnchored(start, g.months), -1) : null;
    const row = await db.group.create({
      data: {
        centerId: center.id,
        branchId: g.branch,
        courseId: g.course.id,
        teacherId: g.teacher,
        roomId: rooms[g.room],
        code: i + 1,
        name: g.name,
        startDate: fromISODate(start),
        endDate: end ? fromISODate(end) : null,
        capacity: g.key === "indiv" ? 4 : 14,
        status: "ACTIVE",
        slots: { create: g.days.map((weekday) => ({ weekday, startTime: g.start, endTime: g.end })) },
      },
    });
    await generateLessons(row.id, { today });
    G[g.key] = { id: row.id, start, courseId: g.course.id, branch: g.branch, days: g.days };
  }
  await db.center.update({ where: { id: center.id }, data: { groupSeq: groupDef.length } });

  // two lessons the center cancelled
  for (const [key, back] of [["ge1", 20], ["ielts", 12]] as const) {
    const l = await db.lesson.findFirst({ where: { groupId: G[key].id, date: { lte: fromISODate(addDays(today, -back)) } }, orderBy: { date: "desc" } });
    if (l) await db.lesson.update({ where: { id: l.id }, data: { status: "CANCELLED", cancelReason: "O'qituvchi kasal" } });
  }

  // ---------------------------------------------------------------- families & students (~45 families, ~60 students)
  type Plan = { group: string; start: ISODate; status: "TRIAL" | "ACTIVE" | "FROZEN" | "LEFT" | "TRANSFER"; to?: string };
  const groupKeys = ["ge1", "ge1", "ge2", "ge2", "ielts", "ielts", "math1", "math1", "py", "ge3", "ge3", "math2", "math2", "indiv"];
  const students: { id: string; familyId: string; plans: Plan[] }[] = [];
  let familiesMade = 0;
  for (let f = 0; f < 45; f++) {
    const surname = pick(SURNAMES);
    const kids = f < 15 ? 2 : 1;
    const motherName = `${pick(FEMALE)} ${surname}a`;
    const family = await db.family.create({ data: { centerId: center.id, name: `${surname}lar oilasi`, createdAt: fromISODate(addDays(today, -int(20, 95))) } });
    familiesMade++;
    await db.guardian.create({ data: { familyId: family.id, name: motherName, phone: phone(), relation: "mother", isPrimary: true } });
    if (chance(0.4)) await db.guardian.create({ data: { familyId: family.id, name: `${pick(MALE)} ${surname}`, phone: phone(), relation: "father" } });
    for (let k = 0; k < kids; k++) {
      const male = chance(0.5);
      const groupKey = pick(groupKeys);
      const g = G[groupKey];
      const st = await db.student.create({
        data: {
          centerId: center.id,
          familyId: family.id,
          branchId: g.branch,
          firstName: male ? pick(MALE) : pick(FEMALE),
          lastName: male ? surname : `${surname}a`,
          phone: chance(0.5) ? phone() : null,
          birthDate: fromISODate(`${int(2006, 2016)}-${String(int(1, 12)).padStart(2, "0")}-${String(int(1, 28)).padStart(2, "0")}`),
          gender: male ? "M" : "F",
          source: pick(SOURCES),
          tags: chance(0.15) ? ["VIP"] : [],
        },
      });
      // when they joined: at the group start or a little later
      const daysSinceStart = Math.round((fromISODate(today).getTime() - fromISODate(g.start).getTime()) / 86_400_000);
      const joinOffset = chance(0.6) ? 0 : int(3, Math.max(4, daysSinceStart - 10));
      const start = addDays(g.start, joinOffset);
      const r = rnd();
      let plan: Plan;
      if (r < 0.07) plan = { group: groupKey, start: addDays(today, int(-1, 2)), status: "TRIAL" };
      else if (r < 0.12) plan = { group: groupKey, start, status: "FROZEN" };
      else if (r < 0.2) plan = { group: groupKey, start, status: "LEFT" };
      else if (r < 0.25 && (groupKey === "ge1" || groupKey === "ge2")) plan = { group: groupKey, start, status: "TRANSFER", to: groupKey === "ge1" ? "ge2" : "ge1" };
      else plan = { group: groupKey, start, status: "ACTIVE" };
      const plans = [plan];
      // a few students also take a second course
      if (chance(0.08) && plan.status === "ACTIVE" && groupKey !== "indiv") plans.push({ group: "indiv", start: addDays(G.indiv.start, int(0, 20)), status: "ACTIVE" });
      students.push({ id: st.id, familyId: family.id, plans });
      await db.student.update({ where: { id: st.id }, data: { createdAt: new Date(fromISODate(addDays(plan.start, -int(0, 3))).getTime() + int(9, 18) * 3_600_000) } });
    }
  }

  // ---------------------------------------------------------------- enrollments
  const LEFT_REASONS = ["Narx qimmat", "Vaqt to'g'ri kelmadi", "Boshqa markazga o'tdi", "Ko'chib ketdi", "O'qishni to'xtatdi"];
  const enrollmentIds: string[] = [];
  const seenOpen = new Set<string>();
  for (const s of students) {
    for (const p of s.plans) {
      const g = G[p.group];
      if (seenOpen.has(`${s.id}:${g.id}`)) continue;
      seenOpen.add(`${s.id}:${g.id}`);
      if (p.status === "TRIAL") {
        const e = await db.enrollment.create({ data: { studentId: s.id, groupId: g.id, startDate: fromISODate(p.start), status: "TRIAL" } });
        enrollmentIds.push(e.id);
        await audit(center.id, "Enrollment", e.id, "enroll.trial");
        continue;
      }
      // most students had one free trial lesson, then billing started on the next lesson
      const firstLessons = await db.lesson.findMany({ where: { groupId: g.id, date: { gte: fromISODate(p.start) }, status: { not: "CANCELLED" } }, orderBy: { date: "asc" }, take: 2, select: { date: true } });
      const hadTrial = chance(0.6) && firstLessons.length === 2 && toISODate(firstLessons[1].date) < today;
      const activatedAt = hadTrial ? toISODate(firstLessons[1].date) : p.start;
      if (p.status === "TRANSFER") {
        const back = addDays(today, -int(8, 25));
        const moveDate = back > activatedAt ? back : addDays(activatedAt, 7);
        const to = G[p.to!];
        const nextE = await db.enrollment.create({ data: { studentId: s.id, groupId: to.id, startDate: fromISODate(moveDate), activatedAt: fromISODate(moveDate), status: "ACTIVE" } });
        const e = await db.enrollment.create({
          data: { studentId: s.id, groupId: g.id, startDate: fromISODate(p.start), activatedAt: fromISODate(activatedAt), endDate: fromISODate(addDays(moveDate, -1)), status: "TRANSFERRED", transferredToId: nextE.id },
        });
        enrollmentIds.push(e.id, nextE.id);
        await audit(center.id, "Enrollment", e.id, "transfer", { to: nextE.id, moveDate });
        continue;
      }
      const discount = chance(0.12) ? { discountPercent: pick([10, 15, 20]), discountReason: pick(["Aka-uka chegirmasi", "Aksiya", "Xodim farzandi"]) } : {};
      const data = { studentId: s.id, groupId: g.id, startDate: fromISODate(p.start), activatedAt: fromISODate(activatedAt), status: "ACTIVE" as const, ...discount };
      if (p.status === "LEFT") {
        const end = addDays(today, -int(5, 30));
        const e = await db.enrollment.create({ data: { ...data, endDate: fromISODate(end < activatedAt ? activatedAt : end), status: "LEFT", leftReason: pick(LEFT_REASONS) } });
        enrollmentIds.push(e.id);
        continue;
      }
      const e = await db.enrollment.create({ data });
      enrollmentIds.push(e.id);
      if (p.status === "FROZEN") {
        const from = addDays(today, -int(3, 10));
        await db.enrollmentFreeze.create({ data: { enrollmentId: e.id, fromDate: fromISODate(from), toDate: fromISODate(addDays(from, int(14, 21))), reason: pick(["Kasallik", "Safar", "Imtihonlar"]) } });
        await db.enrollment.update({ where: { id: e.id }, data: { status: "FROZEN" } });
      }
    }
  }

  // ---------------------------------------------------------------- attendance for past lessons (~85% present)
  const groupsAll = await db.group.findMany({ where: { centerId: center.id }, include: { enrollments: { include: { freezes: true } } } });
  const unmarkedRecent = new Set([G.ge2.id, G.ge3.id]); // leave a few recent lessons for the "attendance missing" view
  let attendanceRows = 0;
  for (const g of groupsAll) {
    const lessons = await db.lesson.findMany({ where: { groupId: g.id, date: { lt: fromISODate(today) }, status: "SCHEDULED" }, orderBy: { date: "asc" } });
    for (const l of lessons) {
      const d = toISODate(l.date);
      if (unmarkedRecent.has(g.id) && d >= addDays(today, -3)) continue;
      const roster = g.enrollments.filter(
        (e) =>
          e.status !== "TRIAL" &&
          toISODate(e.startDate) <= d &&
          (!e.endDate || toISODate(e.endDate) >= d) &&
          !isFrozenOn({ freezes: e.freezes.map((f) => ({ from: toISODate(f.fromDate), to: toISODate(f.toDate) })) }, d),
      );
      if (roster.length === 0) continue;
      const rows = roster.map((e) => {
        const r = rnd();
        const status = r < 0.85 ? "PRESENT" : r < 0.9 ? "LATE" : r < 0.97 ? "ABSENT" : "EXCUSED";
        return { lessonId: l.id, studentId: e.studentId, enrollmentId: e.id, status: status as "PRESENT", grade: status === "PRESENT" || status === "LATE" ? (chance(0.6) ? int(3, 5) : null) : null, markedById: g.teacherId };
      });
      await db.attendance.createMany({ data: rows });
      await db.lesson.update({ where: { id: l.id }, data: { status: "HELD", heldAt: new Date(`${d}T${l.endTime}:00+05:00`), markedById: g.teacherId } });
      attendanceRows += rows.length;
    }
  }

  // ---------------------------------------------------------------- billing, replayed through time
  for (const id of enrollmentIds) {
    const e = await db.enrollment.findUniqueOrThrow({ where: { id } });
    if (!e.activatedAt) continue;
    const from = toISODate(e.activatedAt);
    const dates = new Set<ISODate>([from]);
    for (let m = from.slice(0, 7); m <= today.slice(0, 7); m = shiftMonth(m, 1)) {
      for (const day of ["01", "15"]) {
        const dd = `${m}-${day}`;
        if (dd > from && dd <= today) dates.add(dd);
      }
    }
    if (e.endDate) dates.add(addDays(toISODate(e.endDate), 1) <= today ? addDays(toISODate(e.endDate), 1) : today);
    dates.add(today);
    for (const asOf of [...dates].sort()) await syncEnrollment(id, { asOf });
  }

  // ---------------------------------------------------------------- payments: most families pay a few days after each charge
  const families = await db.family.findMany({ where: { centerId: center.id }, select: { id: true } });
  const debtors = new Set(families.filter(() => chance(0.32)).map((f) => f.id));
  const paymentIds: string[] = [];
  for (const f of families) {
    const charges = await db.ledgerEntry.findMany({ where: { familyId: f.id, type: { in: ["CHARGE", "CREDIT"] } }, orderBy: { date: "asc" } });
    const byDate = new Map<ISODate, number>();
    for (const c of charges) byDate.set(toISODate(c.date), (byDate.get(toISODate(c.date)) ?? 0) - c.amount);
    const dates = [...byDate.keys()].sort();
    for (const [i, d] of dates.entries()) {
      let amount = byDate.get(d)!;
      if (amount <= 0) continue;
      const isLast = i >= dates.length - 1;
      if (debtors.has(f.id) && (isLast || chance(0.3))) {
        if (chance(0.5)) continue; // nothing paid yet
        amount = Math.round((amount * pick([0.3, 0.5])) / 1000) * 1000; // partial
      }
      const later = addDays(d, int(0, 6));
      const payDate = later > today ? today : later;
      if (amount <= 0) continue;
      const by = chance(0.5) ? admin : cashier;
      const entry = await takePayment(by, { familyId: f.id, amount, method: pick(["CASH", "CASH", "CARD", "TRANSFER"] as const), date: payDate });
      paymentIds.push(entry.id);
    }
  }
  // a few mistakes reversed, one refund
  for (const id of paymentIds.filter(() => chance(0.03)).slice(0, 4)) {
    const p = await db.ledgerEntry.findUniqueOrThrow({ where: { id } });
    await reversePayment(owner, id, "Xato kiritilgan");
    await takePayment(admin, { familyId: p.familyId, amount: p.amount, method: "CASH", date: toISODate(p.date), note: "Qayta kiritildi" });
  }
  const prepaid = await db.ledgerEntry.groupBy({ by: ["familyId"], where: { centerId: center.id }, _sum: { amount: true }, having: { amount: { _sum: { gt: 100_000 } } } });
  if (prepaid[0]) await refund(owner, { familyId: prepaid[0].familyId, amount: 100_000, method: "CASH", reason: "Ortiqcha to'lov qaytarildi" });

  // ---------------------------------------------------------------- expenses for 3 months
  for (let k = 2; k >= 0; k--) {
    const m = shiftMonth(today.slice(0, 7), -k);
    const r = monthRange(m);
    const day = (n: number) => (`${m}-${String(n).padStart(2, "0")}` <= today ? `${m}-${String(n).padStart(2, "0")}` : null);
    const list: [string, string | null, number, number][] = [
      ["Ijara / Rent", chilonzor.id, 8_000_000, 3],
      ["Ijara / Rent", yunusobod.id, 9_500_000, 3],
      ["Kommunal / Utilities", chilonzor.id, int(900, 1400) * 1000, 10],
      ["Kommunal / Utilities", yunusobod.id, int(900, 1400) * 1000, 10],
      ["Reklama / Ads", null, int(2000, 4000) * 1000, 12],
      ["Ofis / Office", null, int(300, 800) * 1000, 18],
    ];
    for (const [category, branchId, amount, d] of list) {
      const date = day(d);
      if (!date || date < r.start) continue;
      await db.expense.create({ data: { centerId: center.id, branchId, category, amount, date: fromISODate(date), createdById: U.owner, note: m } });
    }
  }

  // ---------------------------------------------------------------- salaries: rules for all, last month locked & paid
  const ruleStart = fromISODate(monthRange(shiftMonth(today.slice(0, 7), -4)).start);
  await db.salaryRule.createMany({
    data: [
      { teacherId: U.aziza, model: "PERCENT_EARNED", percent: 40, validFrom: ruleStart },
      { teacherId: U.bobur, model: "BASE_PLUS_PERCENT", fixedAmount: 2_000_000, percent: 20, validFrom: ruleStart },
      { teacherId: U.nodira, model: "PER_LESSON", perLesson: 120_000, validFrom: ruleStart },
      { teacherId: U.otabek, model: "FIXED", fixedAmount: 4_000_000, validFrom: ruleStart },
    ],
  });
  const lastMonth = shiftMonth(today.slice(0, 7), -1);
  await db.salaryAdjustment.create({ data: { teacherId: U.aziza, month: lastMonth, amount: 300_000, reason: "Ochiq dars uchun bonus", createdById: U.owner } });
  await db.salaryAdjustment.create({ data: { teacherId: U.bobur, month: lastMonth, amount: -50_000, reason: "Kechikish", createdById: U.owner } });
  for (const tid of [U.aziza, U.bobur, U.nodira, U.otabek]) {
    await lockPayslip(owner, tid, lastMonth);
    await markPayslipPaid(owner, tid, lastMonth);
  }

  // ---------------------------------------------------------------- leads (30, every stage, with notes)
  const stages = ["NEW", "NEW", "NEW", "NEW", "NEW", "CONTACTED", "CONTACTED", "CONTACTED", "CONTACTED", "CONTACTED", "CONTACTED", "TRIAL_BOOKED", "TRIAL_BOOKED", "TRIAL_BOOKED", "TRIAL_BOOKED", "TRIAL_DONE", "TRIAL_DONE", "TRIAL_DONE", "ENROLLED", "ENROLLED", "ENROLLED", "ENROLLED", "ENROLLED", "ENROLLED", "LOST", "LOST", "LOST", "LOST", "LOST", "LOST"] as const;
  const enrolledStudents = await db.student.findMany({ where: { centerId: center.id }, select: { id: true, firstName: true, lastName: true, phone: true }, take: 6, orderBy: { createdAt: "asc" } });
  const NOTES = ["Qo'ng'iroq qilindi, ertaga qayta qo'ng'iroq", "Narxni so'radi", "Sinov darsiga yozildi", "Ota-onasi bilan gaplashish kerak", "Instagramdan yozdi", "Kechki guruhni xohlaydi"];
  const LOST = ["Narx qimmat", "Uzoq", "Boshqa markazni tanladi", "Javob bermadi"];
  const courses = Object.values(C);
  for (const [i, stage] of stages.entries()) {
    const male = chance(0.5);
    const linked = stage === "ENROLLED" ? enrolledStudents[i % enrolledStudents.length] : null;
    const createdAt = new Date(fromISODate(addDays(today, -int(0, 40))).getTime() + int(9, 19) * 3_600_000);
    const lead = await db.lead.create({
      data: {
        centerId: center.id,
        branchId: chance(0.5) ? chilonzor.id : yunusobod.id,
        name: linked ? `${linked.firstName} ${linked.lastName}` : `${male ? pick(MALE) : pick(FEMALE)} ${pick(SURNAMES)}${male ? "" : "a"}`,
        phone: linked?.phone ?? phone(),
        source: pick(SOURCES),
        courseId: pick(courses).id,
        stage,
        assignedToId: chance(0.5) ? U.admin : U.cashier,
        nextContactAt: stage === "ENROLLED" || stage === "LOST" ? null : fromISODate(addDays(today, int(-3, 4))),
        lostReason: stage === "LOST" ? pick(LOST) : null,
        studentId: linked?.id ?? null,
        createdAt,
      },
    });
    for (let n = 0; n < int(1, 3); n++) {
      await db.leadNote.create({ data: { leadId: lead.id, text: pick(NOTES), createdById: U.admin, createdAt: new Date(createdAt.getTime() + n * 86_400_000) } });
    }
  }

  // ---------------------------------------------------------------- summary
  const [studentsN, enrollmentsN, ledgerN] = await Promise.all([db.student.count(), db.enrollment.count(), db.ledgerEntry.count()]);
  let debtFamilies = 0;
  for (const f of families) if ((await familyAllocation(f.id)).balance < 0) debtFamilies++;
  console.log(
    `[seed] done in ${Math.round((Date.now() - t0) / 1000)}s: ${familiesMade} families, ${studentsN} students, ${enrollmentsN} enrollments, ` +
      `${attendanceRows} attendance rows, ${ledgerN} ledger rows, ${debtFamilies} families with debt`,
  );
}
