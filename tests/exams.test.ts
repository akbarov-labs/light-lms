// Exams and certificates on the database: access, results, publish, certificates, revoke, report card link.
// Run: npm run test:integration
import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { fromISODate } from "@/lib/dates";
import { createExam, examRoster, issueForExam, issueManual, publishResults, revokeCertificate, saveResults, type ExamAccess } from "@/lib/services/exams";
import { cardData, ensureCards } from "@/lib/services/report-cards";
import { UserError } from "@/lib/user-error";

let centerId = "";
let groupId = "";
let branchId = "";
let otherBranchId = "";
let teacherId = "";
let aId = "";
let bId = "";
let leadId = "";
let aEnrollment = "";
const owner = (): ExamAccess => ({ userId: teacherId, centerId, canEdit: true, branchIds: null });
const teacher = (): ExamAccess => ({ userId: teacherId, centerId, canEdit: false, branchIds: [branchId] });

beforeAll(async () => {
  const slug = `exam-${Date.now()}`;
  centerId = (await db.center.create({ data: { name: "Imtihon markazi", slug } })).id;
  branchId = (await db.branch.create({ data: { centerId, name: "A" } })).id;
  otherBranchId = (await db.branch.create({ data: { centerId, name: "B" } })).id;
  teacherId = (await db.user.create({ data: { centerId, phone: `99893${String(Date.now()).slice(-7)}`, name: "Ustoz", passwordHash: "x", role: "TEACHER", isTeacher: true } })).id;
  const course = await db.course.create({ data: { centerId, name: "IELTS Foundation", level: "B1", pricingType: "SUBSCRIPTION", price: 900_000 } });
  groupId = (await db.group.create({ data: { centerId, branchId, courseId: course.id, teacherId, code: 1, name: "IELTS-1", startDate: fromISODate("2026-09-01") } })).id;
  const fam = await db.family.create({ data: { centerId, name: "Oila", guardians: { create: { name: "Ona", phone: "998901234500", telegramChatId: "888001" } } } });
  aId = (await db.student.create({ data: { centerId, familyId: fam.id, firstName: "Aziz", lastName: "Karimov" } })).id;
  bId = (await db.student.create({ data: { centerId, familyId: fam.id, firstName: "Bekzod", lastName: "Karimov" } })).id;
  aEnrollment = (await db.enrollment.create({ data: { studentId: aId, groupId, startDate: fromISODate("2026-09-01"), activatedAt: fromISODate("2026-09-01"), status: "ACTIVE" } })).id;
  await db.enrollment.create({ data: { studentId: bId, groupId, startDate: fromISODate("2026-09-01"), activatedAt: fromISODate("2026-09-01"), status: "ACTIVE" } });
  leadId = (await db.lead.create({ data: { centerId, name: "Yangi lid", phone: "998909998877" } })).id;
});

describe("exams", () => {
  let examId = "";
  it("creates a sectioned level exam; max = sum of sections; pass mark must fit", async () => {
    const base = { kind: "LEVEL" as const, title: "B1 yakuniy", date: "2026-10-15", groupId, courseId: null, branchId: null, maxScore: 0, passScore: 60, sections: [{ name: "L", max: 50 }, { name: "R", max: 50 }], bands: [] };
    examId = await createExam(owner(), base);
    const e = await db.exam.findUniqueOrThrow({ where: { id: examId } });
    expect(e).toMatchObject({ maxScore: 100, passScore: 60, branchId });
    await expect(createExam(owner(), { ...base, passScore: 120 })).rejects.toBeInstanceOf(UserError);
    await expect(createExam(teacher(), base)).rejects.toBeInstanceOf(UserError);
    await expect(createExam({ ...owner(), branchIds: [otherBranchId] }, base)).rejects.toBeInstanceOf(UserError);
  });
  it("the roster is the group on the exam date", async () => {
    const e = await db.exam.findUniqueOrThrow({ where: { id: examId } });
    expect((await examRoster(e)).map((r) => r.studentId).sort()).toEqual([aId, bId].sort());
  });
  it("the group's teacher enters results; scores are checked; empty rows clear", async () => {
    expect(await saveResults(teacher(), examId, [{ studentId: aId, sections: [40, 35] }, { studentId: bId, sections: [20, 25], comment: "Grammatika" }])).toEqual({ saved: 2, cleared: 0 });
    const a = await db.examResult.findFirstOrThrow({ where: { examId, studentId: aId } });
    expect(a).toMatchObject({ score: 75, passed: true, sectionScores: [40, 35] });
    expect((await db.examResult.findFirstOrThrow({ where: { examId, studentId: bId } })).passed).toBe(false);
    await expect(saveResults(teacher(), examId, [{ studentId: aId, sections: [51, 0] }])).rejects.toBeInstanceOf(UserError);
    await expect(saveResults({ ...teacher(), userId: "someone-else" }, examId, [{ studentId: aId, sections: [1, 1] }])).rejects.toBeInstanceOf(UserError);
    expect(await saveResults(teacher(), examId, [{ studentId: aId, sections: [40, 35] }])).toEqual({ saved: 0, cleared: 0 }); // unchanged
  });
  it("publishing queues one message per student result; re-publishing adds nothing", async () => {
    expect(await publishResults(owner(), examId)).toBe(2);
    expect(await publishResults(owner(), examId)).toBe(0);
    const n = await db.notification.findFirstOrThrow({ where: { centerId, dedupeKey: { startsWith: `exam:${examId}:${aId}` } } });
    expect(n.text).toContain("75 / 100");
    await expect(publishResults(teacher(), examId)).rejects.toBeInstanceOf(UserError);
  });
  it("certificates go to passed students only, once; the score is then locked", async () => {
    expect(await issueForExam(owner(), examId, "2026-10-16")).toBe(1);
    expect(await issueForExam(owner(), examId, "2026-10-16")).toBe(0);
    const c = await db.certificate.findFirstOrThrow({ where: { studentId: aId } });
    expect(c).toMatchObject({ title: "IELTS Foundation", level: "B1", score: 75, maxScore: 100, number: "2026-0001" });
    expect(c.code).toMatch(/^[A-HJ-NP-Z2-9]{10}$/);
    await expect(saveResults(owner(), examId, [{ studentId: aId, sections: [10, 10] }])).rejects.toBeInstanceOf(UserError);
    expect(await saveResults(owner(), examId, [{ studentId: aId, sections: [null, null] }])).toEqual({ saved: 0, cleared: 0 }); // certified rows can't be cleared
  });
  it("manual certificates number on; revoking keeps the row", async () => {
    const m = await issueManual(owner(), { studentId: bId, title: "Speaking club", level: null, issuedAt: "2027-01-05", groupId });
    expect(m.number).toBe("2027-0002");
    const r = await revokeCertificate(owner(), m.id, "xato berildi");
    expect(r.revokedAt).not.toBeNull();
    expect(await db.certificate.count({ where: { studentId: bId } })).toBe(1);
    const again = await revokeCertificate(owner(), m.id, "ikkinchi marta"); // already revoked: no-op
    expect(again.revokeReason).toBe("xato berildi");
    await expect(revokeCertificate(owner(), m.id, " ")).rejects.toBeInstanceOf(UserError);
    await expect(revokeCertificate({ ...owner(), canEdit: false }, m.id, "x")).rejects.toBeInstanceOf(UserError);
  });
  it("placement test: a lead gets a level from the bands", async () => {
    const id = await createExam(owner(), { kind: "PLACEMENT", title: "Kirish testi", date: "2026-10-20", groupId: null, courseId: null, branchId, maxScore: 60, passScore: null, sections: [], bands: [{ min: 0, level: "A1" }, { min: 30, level: "A2" }, { min: 45, level: "B1" }] });
    await saveResults(owner(), id, [{ leadId, total: 47 }]);
    expect(await db.examResult.findFirstOrThrow({ where: { examId: id, leadId } })).toMatchObject({ score: 47, level: "B1", passed: null });
    await expect(issueForExam(owner(), id)).rejects.toBeInstanceOf(UserError);
    expect(await publishResults(owner(), id)).toBe(0); // leads have no family to message
  });
  it("the month's exam shows on the student's report card", async () => {
    await ensureCards(centerId, groupId, "2026-10");
    const card = await db.reportCard.findUniqueOrThrow({ where: { enrollmentId_month: { enrollmentId: aEnrollment, month: "2026-10" } } });
    expect((await cardData(card.id)).exams).toEqual([{ title: "B1 yakuniy", date: "2026-10-15", score: 75, maxScore: 100, passed: true, level: null }]);
  });

  it("review: a final exam without a pass mark certifies everyone with a result", async () => {
    const id = await createExam(owner(), { kind: "FINAL", title: "Yakuniy (ballsiz)", date: "2026-10-25", groupId, courseId: null, branchId: null, maxScore: 100, passScore: null, sections: [], bands: [] });
    await saveResults(owner(), id, [{ studentId: aId, total: 40 }, { studentId: bId, total: 90 }]);
    expect(await issueForExam(owner(), id, "2026-10-26")).toBe(2);
  });
  it("review: revoking unlocks the score and the corrected result can be certified again", async () => {
    const id = await createExam(owner(), { kind: "LEVEL", title: "Qayta", date: "2026-10-27", groupId, courseId: null, branchId: null, maxScore: 100, passScore: 50, sections: [], bands: [] });
    await saveResults(owner(), id, [{ studentId: aId, total: 57 }]);
    expect(await issueForExam(owner(), id)).toBe(1);
    const cert = await db.certificate.findFirstOrThrow({ where: { examId: id } });
    await expect(saveResults(owner(), id, [{ studentId: aId, total: 75 }])).rejects.toBeInstanceOf(UserError);
    await revokeCertificate(owner(), cert.id, "ball xato");
    expect(await saveResults(owner(), id, [{ studentId: aId, total: 75 }])).toEqual({ saved: 1, cleared: 0 });
    expect(await issueForExam(owner(), id)).toBe(1);
    const certs = await db.certificate.findMany({ where: { examId: id }, orderBy: { createdAt: "asc" } });
    expect(certs.map((c) => [c.score, !!c.revokedAt])).toEqual([[57, true], [75, false]]);
  });
  it("review: a teacher grades only the roster; branch-scoped staff only their branches", async () => {
    const outsider = await db.student.create({ data: { centerId, familyId: (await db.family.create({ data: { centerId, name: "Tashqi" } })).id, branchId: otherBranchId, firstName: "Tashqi", lastName: "Bola" } });
    const otherLead = await db.lead.create({ data: { centerId, branchId: otherBranchId, name: "B lid", phone: "998905554433" } });
    const id = await createExam(owner(), { kind: "MOCK", title: "Mock", date: "2026-10-28", groupId, courseId: null, branchId: null, maxScore: 10, passScore: null, sections: [], bands: [] });
    await expect(saveResults(teacher(), id, [{ studentId: outsider.id, total: 5 }])).rejects.toBeInstanceOf(UserError);
    await expect(saveResults(teacher(), id, [{ leadId, total: 5 }])).rejects.toBeInstanceOf(UserError);
    expect((await saveResults(teacher(), id, [{ studentId: aId, total: 5 }])).saved).toBe(1);
    const branchA = { ...owner(), branchIds: [branchId] };
    await expect(saveResults(branchA, id, [{ studentId: outsider.id, total: 5 }])).rejects.toBeInstanceOf(UserError);
    await expect(saveResults(branchA, id, [{ leadId: otherLead.id, total: 5 }])).rejects.toBeInstanceOf(UserError);
    await expect(issueManual(branchA, { studentId: outsider.id, title: "X", level: null, issuedAt: "2026-10-28" })).rejects.toBeInstanceOf(UserError);
    const cert = await issueManual(owner(), { studentId: outsider.id, title: "X", level: null, issuedAt: "2026-10-28" });
    await expect(revokeCertificate(branchA, cert.id, "x")).rejects.toBeInstanceOf(UserError);
  });
  it("review: a corrected result is sent again, even back to an earlier score", async () => {
    const id = await createExam(owner(), { kind: "MOCK", title: "Qayta yuborish", date: "2026-10-29", groupId, courseId: null, branchId: null, maxScore: 100, passScore: null, sections: [], bands: [] });
    await saveResults(owner(), id, [{ studentId: aId, total: 80 }]);
    expect(await publishResults(owner(), id)).toBe(1);
    await saveResults(owner(), id, [{ studentId: aId, total: 90 }]);
    expect(await publishResults(owner(), id)).toBe(1);
    await saveResults(owner(), id, [{ studentId: aId, total: 80 }]);
    expect(await publishResults(owner(), id)).toBe(1);
    expect(await publishResults(owner(), id)).toBe(0);
  });
});
