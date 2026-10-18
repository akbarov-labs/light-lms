// Exams, results and certificates (v2). Scoring rules live in src/lib/academics/exams.ts.
import type { ExamKind, Prisma } from "@/generated/prisma/client";
import { db, type Tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { fromISODate, toISODate, todayISO, type ISODate } from "@/lib/dates";
import { certificateNumber, ExamInputError, scoreResult, sectionsMax, verifyCode, type LevelBand, type Section } from "@/lib/academics/exams";
import { readSettings } from "@/lib/settings";
import { notifyFamily } from "@/lib/notify";
import { msg } from "@/lib/messages";
import { appUrl } from "@/lib/env";
import { fullName } from "@/lib/format";
import { UserError } from "@/lib/user-error";
import type { Actor } from "./enrollments";

/** Who is acting and what they may touch (built from Ctx by the actions). */
export interface ExamAccess {
  userId: string;
  centerId: string;
  /** groups.edit: create exams, publish, issue and revoke certificates */
  canEdit: boolean;
  branchIds: string[] | null;
}

export const sectionsOf = (raw: unknown): Section[] => (Array.isArray(raw) ? (raw as Section[]) : []);
export const bandsOf = (raw: unknown): LevelBand[] => (Array.isArray(raw) ? (raw as LevelBand[]) : []);

const inBranches = (a: ExamAccess, branchId: string | null) => !a.branchIds || (branchId !== null && a.branchIds.includes(branchId));

/** The exam, if this user may work on it: staff with groups.edit in its branch, or the teacher of its group. */
export async function examFor(a: ExamAccess, examId: string, mode: "results" | "manage" = "manage") {
  const exam = await db.exam.findFirst({
    where: { id: examId, centerId: a.centerId },
    include: { group: { select: { id: true, name: true, code: true, teacherId: true, branchId: true, course: { select: { name: true, level: true } } } }, course: { select: { id: true, name: true, level: true } } },
  });
  if (!exam) throw new UserError("error.notFound");
  const branchId = exam.group?.branchId ?? exam.branchId;
  const staff = a.canEdit && inBranches(a, branchId);
  const teacher = mode === "results" && !!exam.group && exam.group.teacherId === a.userId;
  if (!staff && !teacher) throw new UserError("error.forbidden");
  return exam;
}

export interface ExamInput {
  kind: ExamKind;
  title: string;
  date: ISODate;
  groupId: string | null;
  courseId: string | null;
  branchId: string | null;
  maxScore: number;
  passScore: number | null;
  sections: Section[];
  bands: LevelBand[];
}

export async function createExam(a: ExamAccess, input: ExamInput): Promise<string> {
  if (!a.canEdit) throw new UserError("error.forbidden");
  let branchId = input.branchId;
  let courseId = input.courseId;
  if (input.groupId) {
    const g = await db.group.findFirst({ where: { id: input.groupId, centerId: a.centerId }, select: { branchId: true, courseId: true } });
    if (!g) throw new UserError("error.notFound");
    branchId = g.branchId;
    courseId = courseId ?? g.courseId;
  }
  if (courseId && !(await db.course.findFirst({ where: { id: courseId, centerId: a.centerId }, select: { id: true } }))) throw new UserError("error.notFound");
  if (branchId && !(await db.branch.findFirst({ where: { id: branchId, centerId: a.centerId }, select: { id: true } }))) throw new UserError("error.notFound");
  if (!inBranches(a, branchId)) throw new UserError("error.forbidden");
  // with sections the maximum is their sum; a pass mark above the maximum can never be met
  const maxScore = input.sections.length ? sectionsMax(input.sections) : input.maxScore;
  if (maxScore <= 0) throw new UserError("exams.badMax");
  if (input.passScore !== null && (input.passScore < 0 || input.passScore > maxScore)) throw new UserError("exams.badPass");
  if (input.bands.some((b) => b.min > maxScore)) throw new UserError("exams.badBands");
  return db.$transaction(async (tx) => {
    const exam = await tx.exam.create({
      data: {
        centerId: a.centerId,
        branchId,
        groupId: input.groupId,
        courseId,
        kind: input.kind,
        title: input.title,
        date: fromISODate(input.date),
        maxScore,
        passScore: input.passScore,
        sections: input.sections as unknown as Prisma.InputJsonValue,
        levelBands: input.bands as unknown as Prisma.InputJsonValue,
        createdById: a.userId,
      },
    });
    await audit(tx, { centerId: a.centerId, userId: a.userId, entity: "Exam", entityId: exam.id, action: "create", after: exam });
    return exam.id;
  });
}

/** Students who sit a group exam: enrolled (and not frozen) on the exam date, trials included. */
export async function examRoster(exam: { groupId: string | null; date: Date }) {
  if (!exam.groupId) return [];
  const d = exam.date;
  const rows = await db.enrollment.findMany({
    where: { groupId: exam.groupId, startDate: { lte: d }, OR: [{ endDate: null }, { endDate: { gte: d } }], freezes: { none: { fromDate: { lte: d }, toDate: { gte: d } } } },
    include: { student: { select: { id: true, firstName: true, lastName: true } } },
  });
  return rows.map((e) => ({ studentId: e.studentId, name: fullName(e.student) })).sort((x, y) => x.name.localeCompare(y.name));
}

export interface ResultRow {
  studentId?: string | null;
  leadId?: string | null;
  total?: number | null;
  sections?: (number | null)[];
  comment?: string | null;
}

/**
 * Save the typed results. An empty row clears an existing result unless it already has a certificate
 * (then the score must stay). Students must belong to the center; leads too. Returns rows written.
 */
export async function saveResults(a: ExamAccess, examId: string, rows: ResultRow[]): Promise<{ saved: number; cleared: number }> {
  const exam = await examFor(a, examId, "results");
  if (exam.archivedAt) throw new UserError("error.locked");
  const scoring = { maxScore: exam.maxScore, passScore: exam.passScore, sections: sectionsOf(exam.sections), bands: bandsOf(exam.levelBands) };
  let saved = 0;
  let cleared = 0;
  await db.$transaction(async (tx) => {
    for (const r of rows) {
      const who = r.studentId ? { studentId: r.studentId } : r.leadId ? { leadId: r.leadId } : null;
      if (!who) continue;
      if (r.studentId && !(await tx.student.findFirst({ where: { id: r.studentId, centerId: a.centerId }, select: { id: true } }))) throw new UserError("error.notFound");
      if (r.leadId && !(await tx.lead.findFirst({ where: { id: r.leadId, centerId: a.centerId }, select: { id: true } }))) throw new UserError("error.notFound");
      let scored;
      try {
        scored = scoreResult(scoring, { total: r.total, sections: r.sections });
      } catch (e) {
        if (e instanceof ExamInputError) throw new UserError("exams.badScore", { max: exam.maxScore });
        throw e;
      }
      const existing = await tx.examResult.findFirst({ where: { examId, ...who }, include: { certificate: { select: { id: true } } } });
      const comment = r.comment?.trim().slice(0, 500) || null;
      if (!scored) {
        if (existing && !existing.certificate) {
          await tx.examResult.delete({ where: { id: existing.id } });
          await audit(tx, { centerId: a.centerId, userId: a.userId, entity: "ExamResult", entityId: existing.id, action: "clear", before: existing });
          cleared++;
        }
        continue;
      }
      const data = { score: scored.score, sectionScores: scored.sectionScores, passed: scored.passed, level: scored.level, comment, enteredById: a.userId };
      if (existing) {
        const same = existing.score === data.score && existing.comment === comment && JSON.stringify(existing.sectionScores) === JSON.stringify(data.sectionScores);
        if (same) continue;
        if (existing.certificate && existing.score !== data.score) throw new UserError("exams.certified");
        const after = await tx.examResult.update({ where: { id: existing.id }, data });
        await audit(tx, { centerId: a.centerId, userId: a.userId, entity: "ExamResult", entityId: existing.id, action: "update", before: existing, after });
      } else {
        const after = await tx.examResult.create({ data: { examId, ...who, ...data } });
        await audit(tx, { centerId: a.centerId, userId: a.userId, entity: "ExamResult", entityId: after.id, action: "create", after });
      }
      saved++;
    }
  }, { timeout: 30_000 });
  return { saved, cleared };
}

/** Send each student's result to their family (Telegram, + SMS when on). Re-publishing sends only new results. */
export async function publishResults(a: ExamAccess, examId: string): Promise<number> {
  const exam = await examFor(a, examId);
  const center = await db.center.findUniqueOrThrow({ where: { id: a.centerId }, select: { name: true, settings: true } });
  const results = await db.examResult.findMany({ where: { examId, studentId: { not: null } }, include: { student: { select: { id: true, firstName: true, lastName: true, familyId: true } } } });
  const notify = readSettings(center.settings).notify.examResult;
  let n = 0;
  await db.$transaction(async (tx) => {
    if (notify) {
      for (const r of results) {
        const s = r.student!;
        n += await notifyFamily(tx, {
          centerId: a.centerId,
          familyId: s.familyId,
          studentId: s.id,
          event: "examResult",
          text: (l) => msg.examResult(l, { center: center.name, student: fullName(s), exam: exam.title, date: toISODate(exam.date), score: r.score, maxScore: exam.maxScore, passed: r.passed, level: r.level }),
          dedupeKey: `exam:${examId}:${s.id}:${r.score}`,
        });
      }
    }
    await tx.exam.update({ where: { id: examId }, data: { publishedAt: new Date() } });
    await audit(tx, { centerId: a.centerId, userId: a.userId, entity: "Exam", entityId: examId, action: "publish", after: { results: results.length, queued: n } });
  }, { timeout: 30_000 });
  return n;
}

async function nextNumber(tx: Tx, centerId: string, issuedAt: ISODate): Promise<string> {
  const c = await tx.center.update({ where: { id: centerId }, data: { certSeq: { increment: 1 } }, select: { certSeq: true } });
  return certificateNumber(Number(issuedAt.slice(0, 4)), c.certSeq);
}

interface CertInput {
  studentId: string;
  title: string;
  level: string | null;
  score?: number | null;
  maxScore?: number | null;
  issuedAt: ISODate;
  examId?: string | null;
  examResultId?: string | null;
  groupId?: string | null;
  courseId?: string | null;
}

async function createCertificate(tx: Tx, actor: Actor, c: CertInput) {
  // a code collision is astronomically unlikely (31^10); check first — a unique error would abort the transaction
  let code = verifyCode();
  for (let i = 0; i < 5 && (await tx.certificate.findUnique({ where: { code }, select: { id: true } })); i++) code = verifyCode();
  const cert = await tx.certificate.create({
    data: {
      centerId: actor.centerId,
      number: await nextNumber(tx, actor.centerId, c.issuedAt),
      studentId: c.studentId,
      title: c.title,
      level: c.level,
      score: c.score ?? null,
      maxScore: c.maxScore ?? null,
      issuedAt: fromISODate(c.issuedAt),
      issuedById: actor.userId,
      code,
      examId: c.examId ?? null,
      examResultId: c.examResultId ?? null,
      groupId: c.groupId ?? null,
      courseId: c.courseId ?? null,
    },
  });
  await audit(tx, { centerId: actor.centerId, userId: actor.userId, entity: "Certificate", entityId: cert.id, action: "issue", after: cert });
  return cert;
}

/**
 * Certificates for a level / final exam: every student result that did not fail (no pass mark = all) and
 * has none yet. Title = the course, level = the result's level or the course level.
 */
export async function issueForExam(a: ExamAccess, examId: string, issuedAt: ISODate = todayISO()): Promise<number> {
  const exam = await examFor(a, examId);
  if (exam.kind !== "LEVEL" && exam.kind !== "FINAL") throw new UserError("exams.noCertForKind");
  const results = await db.examResult.findMany({ where: { examId, studentId: { not: null }, passed: { not: false }, certificate: null } });
  const course = exam.course ?? exam.group?.course ?? null;
  let n = 0;
  for (const r of results) {
    await db.$transaction(async (tx) => {
      // re-check inside the transaction: two clicks must not issue twice
      if (await tx.certificate.findUnique({ where: { examResultId: r.id }, select: { id: true } })) return;
      await createCertificate(tx, { userId: a.userId, centerId: a.centerId }, {
        studentId: r.studentId!,
        title: course?.name ?? exam.title,
        level: r.level ?? course?.level ?? null,
        score: r.score,
        maxScore: exam.maxScore,
        issuedAt,
        examId,
        examResultId: r.id,
        groupId: exam.groupId,
        courseId: exam.courseId ?? null,
      });
      n++;
    });
  }
  return n;
}

/** A certificate without an exam (course completed). */
export async function issueManual(a: ExamAccess, input: { studentId: string; title: string; level: string | null; issuedAt: ISODate; groupId?: string | null }) {
  if (!a.canEdit) throw new UserError("error.forbidden");
  const s = await db.student.findFirst({ where: { id: input.studentId, centerId: a.centerId }, select: { id: true } });
  if (!s) throw new UserError("error.notFound");
  let courseId: string | null = null;
  if (input.groupId) {
    const g = await db.group.findFirst({ where: { id: input.groupId, centerId: a.centerId }, select: { courseId: true, branchId: true } });
    if (!g) throw new UserError("error.notFound");
    if (!inBranches(a, g.branchId)) throw new UserError("error.forbidden");
    courseId = g.courseId;
  }
  return db.$transaction((tx) => createCertificate(tx, { userId: a.userId, centerId: a.centerId }, { ...input, courseId }));
}

export async function revokeCertificate(a: ExamAccess, certId: string, reason: string) {
  if (!a.canEdit) throw new UserError("error.forbidden");
  if (!reason.trim()) throw new UserError("exams.revokeReason");
  const cert = await db.certificate.findFirst({ where: { id: certId, centerId: a.centerId } });
  if (!cert) throw new UserError("error.notFound");
  if (cert.revokedAt) return cert;
  return db.$transaction(async (tx) => {
    const after = await tx.certificate.update({ where: { id: certId }, data: { revokedAt: new Date(), revokedById: a.userId, revokeReason: reason.trim().slice(0, 300) } });
    await audit(tx, { centerId: a.centerId, userId: a.userId, entity: "Certificate", entityId: certId, action: "revoke", before: cert, after });
    return after;
  });
}

export const verifyUrl = (code: string) => `${appUrl()}/v/${code}`;
