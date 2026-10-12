// Load test data: adds a big branch (default 60 groups × 33 students ≈ 2 000 students, 3 months of lessons,
// attendance, charges and payments) to the demo center, so page speed can be measured at a large center's size.
// NEVER run against production. Usage: DATABASE_URL=... npx tsx scripts/scale-test.ts [groups] [perGroup]
import { db } from "../src/lib/db";
import { addDays, fromISODate, toISODate, todayISO } from "../src/lib/dates";
import { generateLessons } from "../src/lib/services/lessons";
import { syncEnrollment } from "../src/lib/billing/sync";
import { takePayment } from "../src/lib/services/payments";

const GROUPS = Number(process.argv[2] ?? 60);
const PER_GROUP = Number(process.argv[3] ?? 33);
const NAMES = ["Aziz", "Bekzod", "Dilshod", "Elbek", "Farrux", "Jasur", "Kamol", "Laziz", "Madina", "Nigora", "Oydin", "Sevara", "Shahnoza", "Umida", "Zarina", "Yasmina"];
const SURNAMES = ["Aliyev", "Karimov", "Rahimov", "Tursunov", "Yusupov", "Sobirov", "Qodirov", "Ergashev", "Usmonov", "Nazarov"];

async function main() {
  const t0 = Date.now();
  const today = todayISO();
  const center = await db.center.findUniqueOrThrow({ where: { slug: "demo" } });
  const course = await db.course.findFirstOrThrow({ where: { centerId: center.id, pricingType: "SUBSCRIPTION" } });
  const teachers = await db.user.findMany({ where: { centerId: center.id, OR: [{ role: "TEACHER" }, { isTeacher: true }] }, select: { id: true } });
  const admin = await db.user.findFirstOrThrow({ where: { centerId: center.id, role: "ADMIN" } });
  const branch = await db.branch.create({ data: { centerId: center.id, name: `Katta filial ${Date.now().toString(36)}` } });
  const startDate = addDays(today, -90);
  let code = (await db.group.aggregate({ where: { centerId: center.id }, _max: { code: true } }))._max.code ?? 0;
  let students = 0;
  let n = 0;
  for (let g = 0; g < GROUPS; g++) {
    const teacherId = teachers[g % teachers.length].id;
    const days = g % 2 ? [2, 4, 6] : [1, 3, 5];
    const hour = 8 + (g % 12);
    const group = await db.group.create({
      data: {
        centerId: center.id, branchId: branch.id, courseId: course.id, teacherId, code: ++code, name: `Load ${g + 1}`,
        startDate: fromISODate(startDate), capacity: PER_GROUP + 2, status: "ACTIVE",
        slots: { create: days.map((weekday) => ({ weekday, startTime: `${String(hour).padStart(2, "0")}:00`, endTime: `${String(hour + 1).padStart(2, "0")}:30` })) },
      },
    });
    await generateLessons(group.id, { today });
    const enrollments: { id: string; studentId: string }[] = [];
    for (let s = 0; s < PER_GROUP; s++, n++) {
      const surname = SURNAMES[n % SURNAMES.length];
      const family = await db.family.create({ data: { centerId: center.id, name: `${surname}lar oilasi`, guardians: { create: { name: `Ota-ona ${n}`, phone: `99890${String(5_000_000 + n).padStart(7, "0")}`, isPrimary: true } } } });
      const st = await db.student.create({ data: { centerId: center.id, familyId: family.id, branchId: branch.id, firstName: NAMES[n % NAMES.length], lastName: surname, phone: `99893${String(5_000_000 + n).padStart(7, "0")}` } });
      const e = await db.enrollment.create({ data: { studentId: st.id, groupId: group.id, startDate: fromISODate(startDate), activatedAt: fromISODate(startDate), status: "ACTIVE" } });
      enrollments.push({ id: e.id, studentId: st.id });
      students++;
    }
    const lessons = await db.lesson.findMany({ where: { groupId: group.id, date: { lt: fromISODate(today) }, status: "SCHEDULED" } });
    for (const l of lessons) {
      await db.attendance.createMany({ data: enrollments.map((e, i) => ({ lessonId: l.id, studentId: e.studentId, enrollmentId: e.id, status: i % 9 === 0 ? ("ABSENT" as const) : ("PRESENT" as const), markedById: teacherId })) });
      await db.lesson.update({ where: { id: l.id }, data: { status: "HELD", heldAt: new Date(`${toISODate(l.date)}T${l.endTime}:00+05:00`), markedById: teacherId } });
    }
    for (const e of enrollments) await syncEnrollment(e.id, { asOf: today });
    // three in four families pay what they were charged; the rest stay in debt
    for (const [i, e] of enrollments.entries()) {
      if (i % 4 === 3) continue;
      const st = await db.student.findUniqueOrThrow({ where: { id: e.studentId }, select: { familyId: true } });
      const due = -((await db.ledgerEntry.aggregate({ where: { familyId: st.familyId }, _sum: { amount: true } }))._sum.amount ?? 0);
      if (due > 0) await takePayment({ userId: admin.id, centerId: center.id }, { familyId: st.familyId, amount: due, method: "CASH", date: today });
    }
    if ((g + 1) % 10 === 0) console.log(`[scale] ${g + 1}/${GROUPS} groups, ${students} students, ${Math.round((Date.now() - t0) / 1000)}s`);
  }
  await db.center.update({ where: { id: center.id }, data: { groupSeq: code } });
  const counts = await Promise.all([db.student.count(), db.ledgerEntry.count(), db.attendance.count(), db.lesson.count()]);
  console.log(`[scale] done in ${Math.round((Date.now() - t0) / 1000)}s — students ${counts[0]}, ledger ${counts[1]}, attendance ${counts[2]}, lessons ${counts[3]}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
