"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, type ActionState } from "@/lib/action";
import { db } from "@/lib/db";
import { formObject, zId } from "@/lib/forms";
import { deleteHomework, saveHomework } from "@/lib/services/homework";

function refresh(lessonId: string) {
  revalidatePath(`/lessons/${lessonId}`);
  revalidatePath(`/t/lessons/${lessonId}`);
}

/** The lesson's own teacher (or staff with groups.edit in the branch) sets or corrects the answer key. */
export async function saveHomeworkAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(undefined, async (ctx) => {
    const f = z.object({ lessonId: zId, key: z.string().max(5000), note: z.string().max(500).optional() }).parse(formObject(fd));
    const r = await saveHomework(ctx, { lessonId: f.lessonId, key: f.key, note: f.note ?? null });
    refresh(f.lessonId);
    return { message: r.created ? ctx.t("homework.created", { n: r.questions, m: r.notified }) : ctx.t("homework.updated", { n: r.questions }) };
  });
}

export async function deleteHomeworkAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(undefined, async (ctx) => {
    const homeworkId = zId.parse(fd.get("homeworkId"));
    const hw = await db.homework.findFirst({ where: { id: homeworkId, centerId: ctx.centerId }, select: { lessonId: true } });
    await deleteHomework(ctx, homeworkId);
    if (hw) refresh(hw.lessonId);
    return { message: ctx.t("homework.deleted") };
  });
}
