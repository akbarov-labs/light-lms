"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, type ActionState } from "@/lib/action";
import { zId, zMonth } from "@/lib/forms";
import { UserError } from "@/lib/user-error";
import type { Ctx } from "@/lib/ctx";
import { groupForCards, saveComments, sendCards, type CardAccess } from "@/lib/services/report-cards";
import { db } from "@/lib/db";

const access = (ctx: Ctx): CardAccess => ({ userId: ctx.userId, centerId: ctx.centerId, canEdit: ctx.can("groups.edit"), branchIds: ctx.branchIds });

/** Teacher comments of a group's month (fields `comment:<cardId>`); `intent=send` also sends the drafts. */
export async function saveReportCardsAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(undefined, async (ctx) => {
    const { groupId, month } = z.object({ groupId: zId, month: zMonth }).parse({ groupId: fd.get("groupId"), month: fd.get("month") });
    const comments = [...fd.entries()]
      .filter(([k]) => k.startsWith("comment:"))
      .map(([k, v]) => ({ cardId: k.slice(8), comment: typeof v === "string" ? v : null }))
      .slice(0, 500);
    const n = await saveComments(access(ctx), groupId, month, comments);
    let message = ctx.t("rc.saved", { n });
    if (fd.get("intent") === "send") {
      // sending is staff work; the group's teacher writes comments
      if (!ctx.can("groups.edit")) throw new UserError("error.forbidden");
      await groupForCards(access(ctx), groupId);
      const drafts = await db.reportCard.findMany({ where: { groupId, month, centerId: ctx.centerId, status: "DRAFT" }, select: { id: true } });
      const r = await sendCards({ userId: ctx.userId, centerId: ctx.centerId }, drafts.map((d) => d.id));
      message = ctx.t("rc.sentResult", r);
    }
    revalidatePath(`/groups/${groupId}/reports`);
    revalidatePath(`/t/reports/${groupId}`);
    return { message };
  });
}
