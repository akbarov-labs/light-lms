"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { runAction, type ActionState } from "@/lib/action";
import { formObject, zBool, zId, zInt, zOptId } from "@/lib/forms";
import {
  closeQuiz,
  createTopicQuiz,
  deleteQuizDraft,
  MAX_QUESTIONS,
  placeAttempt,
  publishQuiz,
  removeQuizQuestion,
  replaceQuizQuestion,
  savePlacement,
  sendResultsToParents,
  setGroupTopic,
  updateQuizDraft,
} from "@/lib/services/quizzes";
import { MAX_MINUTES } from "@/lib/quizzes/timing";

const refresh = (quizId?: string) => {
  revalidatePath("/quizzes");
  if (quizId) revalidatePath(`/quizzes/${quizId}`);
};

export async function createQuizAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const res = await runAction("groups.edit", async (ctx) => {
    const f = z.object({ groupId: zId, topicId: zId, count: zInt(1, MAX_QUESTIONS), minutes: zInt(1, MAX_MINUTES), title: z.string().max(200).optional() }).parse(formObject(fd));
    id = await createTopicQuiz(ctx, f);
    refresh();
  });
  if (res?.ok && id) redirect(`/quizzes/${id}`);
  return res;
}

const questionForm = z.object({ quizId: zId, questionId: zId });

export async function removeQuestionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("groups.edit", async (ctx) => {
    const f = questionForm.parse(formObject(fd));
    await removeQuizQuestion(ctx, f.quizId, f.questionId);
    refresh(f.quizId);
  });
}

export async function replaceQuestionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("groups.edit", async (ctx) => {
    const f = questionForm.parse(formObject(fd));
    await replaceQuizQuestion(ctx, f.quizId, f.questionId);
    refresh(f.quizId);
  });
}

export async function updateQuizAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("groups.edit", async (ctx) => {
    const f = z.object({ quizId: zId, title: z.string().max(200).default(""), minutes: zInt(1, MAX_MINUTES) }).parse(formObject(fd));
    await updateQuizDraft(ctx, f.quizId, f);
    refresh(f.quizId);
  });
}

export async function deleteQuizAction(_: ActionState, fd: FormData): Promise<ActionState> {
  const res = await runAction("groups.edit", async (ctx) => {
    await deleteQuizDraft(ctx, zId.parse(fd.get("quizId")));
    refresh();
  });
  if (res?.ok) redirect("/quizzes");
  return res;
}

export async function publishQuizAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("groups.edit", async (ctx) => {
    const quizId = zId.parse(fd.get("quizId"));
    const r = await publishQuiz(ctx, quizId);
    refresh(quizId);
    return { message: ctx.t("quizzes.publishedN", { n: r.notified }) };
  });
}

export async function closeQuizAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("groups.edit", async (ctx) => {
    const quizId = zId.parse(fd.get("quizId"));
    await closeQuiz(ctx, quizId);
    refresh(quizId);
  });
}

/** The owner's permission for parents to see the results: groups.edit, and the service allows owners and managers only. */
export async function sendParentsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("groups.edit", async (ctx) => {
    const quizId = zId.parse(fd.get("quizId"));
    const r = await sendResultsToParents(ctx, quizId);
    refresh(quizId);
    return { message: ctx.t("quizzes.sentParents", { students: r.students, n: r.sent }) };
  });
}

export async function savePlacementAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("groups.edit", async (ctx) => {
    const f = z.object({ count: zInt(1, 100), passPercent: zInt(1, 100), minutes: zInt(1, MAX_MINUTES), open: zBool }).parse(formObject(fd));
    await savePlacement(ctx, f);
    revalidatePath("/quizzes/placement");
  });
}

/** Enrolling is students.edit, as on the group page. */
export async function placeAttemptAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("students.edit", async (ctx) => {
    const f = z.object({ attemptId: zId, groupId: zId }).parse(formObject(fd));
    await placeAttempt(ctx, f.attemptId, f.groupId);
    revalidatePath("/quizzes/placement");
    return { message: ctx.t("quizzes.placed") };
  });
}

export async function setGroupTopicAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("groups.edit", async (ctx) => {
    const f = z.object({ groupId: zId, topicId: zOptId }).parse(formObject(fd));
    await setGroupTopic(ctx, f.groupId, f.topicId ?? null);
    revalidatePath(`/groups/${f.groupId}`);
  });
}
