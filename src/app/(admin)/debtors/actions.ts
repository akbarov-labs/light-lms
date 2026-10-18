"use server";

import { z } from "zod";
import { runAction, type ActionState } from "@/lib/action";
import { db } from "@/lib/db";
import { assertFamilyAccess } from "@/lib/ctx";
import { formList } from "@/lib/forms";
import { todayISO } from "@/lib/dates";
import { notifyFamily } from "@/lib/notify";
import { msg } from "@/lib/messages";
import { familyBalance } from "@/lib/services/wallet";
import { payLinkForFamily } from "@/lib/payments/links";

/** Queue a debt reminder (with pay link) for each selected family. One per family per day. */
export async function remindAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("payments.take", async (ctx) => {
    const ids = z.array(z.string().min(1)).max(500).parse(formList(fd, "familyId"));
    let n = 0;
    for (const id of ids) {
      await assertFamilyAccess(ctx, id);
      const balance = await familyBalance(id);
      if (balance >= 0) continue;
      const payUrl = await payLinkForFamily(id);
      n += await db.$transaction((tx) =>
        notifyFamily(tx, { centerId: ctx.centerId, familyId: id, event: "debt", text: (l) => msg.debt(l, { center: ctx.center.name, debt: -balance, payUrl }), dedupeKey: `debt-manual:${id}:${todayISO()}` }),
      );
    }
    return { message: ctx.t("debtors.reminded", { n }) };
  });
}
