"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, type ActionState } from "@/lib/action";
import { formObject, zId } from "@/lib/forms";
import type { Ctx } from "@/lib/ctx";
import { approveSure, editQuestion, editTopicTheory, parseOptions, setQuestionStatus, type Reviewer } from "@/lib/services/questions";
import { MAX_THEORY } from "@/lib/questions/extract";

const reviewer = (ctx: Ctx): Reviewer => ({ centerId: ctx.centerId, userId: ctx.userId });

const refresh = (topicId?: string) => {
  revalidatePath("/questions");
  if (topicId) revalidatePath(`/questions/${topicId}`);
};

export async function approveSureAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("groups.edit", async (ctx) => {
    const topicId = zId.parse(fd.get("topicId"));
    const n = await approveSure(reviewer(ctx), topicId);
    refresh(topicId);
    return { message: ctx.t("questions.approvedN", { n }) };
  });
}

export async function setQuestionStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("groups.edit", async (ctx) => {
    const f = z.object({ id: zId, topicId: zId, status: z.enum(["APPROVED", "REJECTED", "DRAFT"]) }).parse(formObject(fd));
    await setQuestionStatus(reviewer(ctx), f.id, f.status);
    refresh(f.topicId);
  });
}

export async function editQuestionAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("groups.edit", async (ctx) => {
    // formObject turns an empty field into undefined: no options = open question, no answer = no key
    const f = z.object({ id: zId, topicId: zId, text: z.string().max(4000).default(""), options: z.string().max(3000).default(""), answer: z.string().max(100).default("") }).parse(formObject(fd));
    await editQuestion(reviewer(ctx), f.id, { text: f.text, options: parseOptions(f.options), answer: f.answer });
    refresh(f.topicId);
  });
}

export async function editTheoryAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("groups.edit", async (ctx) => {
    const f = z.object({ topicId: zId, theory: z.string().max(MAX_THEORY).default("") }).parse(formObject(fd));
    await editTopicTheory(reviewer(ctx), f.topicId, f.theory);
    refresh(f.topicId);
  });
}
