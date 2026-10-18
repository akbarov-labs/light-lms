"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { runAction, type ActionState } from "@/lib/action";
import { formObject, zDate, zId, zOptId, zOptInt, zOptStr, zStr } from "@/lib/forms";
import { UserError } from "@/lib/user-error";
import type { Ctx } from "@/lib/ctx";
import { ExamInputError, parseBands, parseSections } from "@/lib/academics/exams";
import { parseResultForm } from "@/lib/academics/result-form";
import { createExam, issueForExam, issueManual, publishResults, revokeCertificate, saveResults, type ExamAccess } from "@/lib/services/exams";

const access = (ctx: Ctx): ExamAccess => ({ userId: ctx.userId, centerId: ctx.centerId, canEdit: ctx.can("groups.edit"), branchIds: ctx.branchIds });

export async function createExamAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const res = await runAction("groups.edit", async (ctx) => {
    const f = z
      .object({
        kind: z.enum(["PLACEMENT", "LEVEL", "FINAL", "MOCK"]),
        title: zStr,
        date: zDate,
        groupId: zOptId,
        courseId: zOptId,
        branchId: zOptId,
        maxScore: zOptInt(1, 10_000),
        passScore: zOptInt(0, 10_000),
        sections: zOptStr,
        bands: zOptStr,
      })
      .parse(formObject(fd));
    let sections;
    let bands;
    try {
      sections = parseSections(f.sections ?? "");
    } catch (e) {
      if (e instanceof ExamInputError) throw new UserError("exams.badSectionsLine", { line: e.line });
      throw e;
    }
    const maxScore = sections.length ? sections.reduce((s, x) => s + x.max, 0) : (f.maxScore ?? 100);
    try {
      bands = parseBands(f.bands ?? "", maxScore);
    } catch (e) {
      if (e instanceof ExamInputError) throw new UserError("exams.badBandsLine", { line: e.line });
      throw e;
    }
    id = await createExam(access(ctx), { kind: f.kind, title: f.title, date: f.date, groupId: f.groupId ?? null, courseId: f.courseId ?? null, branchId: f.branchId ?? ctx.activeBranchId ?? null, maxScore, passScore: f.passScore ?? null, sections, bands });
    revalidatePath("/exams");
  });
  if (res?.ok && id) redirect(`/exams/${id}`);
  return res;
}

export async function saveExamResultsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(undefined, async (ctx) => {
    const examId = zId.parse(fd.get("examId"));
    const r = await saveResults(access(ctx), examId, parseResultForm(fd));
    revalidatePath(`/exams/${examId}`);
    revalidatePath(`/t/exams/${examId}`);
    return { message: ctx.t("exams.savedResults", r) };
  });
}

/** One participant added by hand (placement tests: leads and students outside the group). */
export async function addParticipantAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(undefined, async (ctx) => {
    const f = z.object({ examId: zId, studentId: zOptId, leadId: zOptId, comment: zOptStr }).parse(formObject(fd));
    if (!f.studentId === !f.leadId) throw new UserError("exams.pickOne");
    const row = parseResultForm(fd)[0] ?? {};
    const r = await saveResults(access(ctx), f.examId, [{ ...row, studentId: f.studentId ?? null, leadId: f.studentId ? null : (f.leadId ?? null), comment: f.comment ?? null }]);
    revalidatePath(`/exams/${f.examId}`);
    return { message: ctx.t("exams.savedResults", r) };
  });
}

export async function publishExamAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("groups.edit", async (ctx) => {
    const examId = zId.parse(fd.get("examId"));
    const n = await publishResults(access(ctx), examId);
    revalidatePath(`/exams/${examId}`);
    return { message: ctx.t("exams.published", { n }) };
  });
}

export async function issueCertificatesAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("groups.edit", async (ctx) => {
    const examId = zId.parse(fd.get("examId"));
    const n = await issueForExam(access(ctx), examId);
    revalidatePath(`/exams/${examId}`);
    revalidatePath("/certificates");
    return { message: ctx.t("exams.issued", { n }) };
  });
}

export async function issueManualCertificateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("groups.edit", async (ctx) => {
    const f = z.object({ studentId: zId, title: zStr, level: zOptStr, issuedAt: zDate, groupId: zOptId }).parse(formObject(fd));
    await issueManual(access(ctx), { studentId: f.studentId, title: f.title, level: f.level ?? null, issuedAt: f.issuedAt, groupId: f.groupId ?? null });
    revalidatePath(`/students/${f.studentId}`);
    revalidatePath("/certificates");
  });
}

export async function revokeCertificateAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("groups.edit", async (ctx) => {
    const f = z.object({ id: zId, reason: zStr }).parse(formObject(fd));
    const c = await revokeCertificate(access(ctx), f.id, f.reason);
    revalidatePath("/certificates");
    revalidatePath(`/students/${c.studentId}`);
  });
}
