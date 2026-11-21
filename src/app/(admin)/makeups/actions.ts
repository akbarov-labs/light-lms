"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, type ActionState } from "@/lib/action";
import { formList, zDate, zId } from "@/lib/forms";
import { planMakeups, setMakeupStatus } from "@/lib/services/makeups";

/** Each checked absence is "studentId:lessonId". */
export async function planMakeupsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("students.edit", async (ctx) => {
    const picked = z.array(z.string().regex(/^[\w-]+:[\w-]+$/)).min(1).max(200).parse(formList(fd, "absence"));
    const date = zDate.parse(fd.get("date"));
    const time = z.string().trim().parse(fd.get("time"));
    const items = picked.map((p) => {
      const [studentId, lessonId] = p.split(":");
      return { studentId, lessonId };
    });
    const n = await planMakeups(ctx, items, date, time);
    revalidatePath("/makeups");
    return { message: ctx.t("makeup.booked", { n }) };
  });
}

export async function makeupStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("students.edit", async (ctx) => {
    const id = zId.parse(fd.get("id"));
    const status = z.enum(["PLANNED", "DONE", "MISSED"]).parse(fd.get("status"));
    await setMakeupStatus(ctx, id, status);
    revalidatePath("/makeups");
  });
}
