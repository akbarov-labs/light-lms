"use server";

// Platform admin (User.platformAdmin, granted by scripts/platform-admin.ts): switch a center off/on and change its plan.
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { runAction, type ActionState } from "@/lib/action";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { formObject, zOptStr } from "@/lib/forms";
import { PLAN_NAMES } from "@/lib/plans";
import { UserError } from "@/lib/user-error";
import type { Ctx } from "@/lib/ctx";

function assertPlatform(ctx: Ctx) {
  if (!ctx.isPlatformAdmin) throw new UserError("error.forbidden");
}

export async function setCenterDisabledAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(undefined, async (ctx) => {
    assertPlatform(ctx);
    const f = z.object({ centerId: z.string().min(1), disable: z.enum(["1", "0"]), reason: zOptStr }).parse(formObject(fd));
    if (f.centerId === ctx.centerId && f.disable === "1") throw new UserError("platform.cannotSelf");
    const c = await db.center.findUnique({ where: { id: f.centerId } });
    if (!c) throw new UserError("error.notFound");
    await db.$transaction(async (tx) => {
      const after = await tx.center.update({
        where: { id: c.id },
        data: f.disable === "1" ? { disabledAt: c.disabledAt ?? new Date(), disabledReason: f.reason ?? null } : { disabledAt: null, disabledReason: null },
      });
      // the audit row lives in the affected center's journal; userId is the platform admin
      await audit(tx, {
        centerId: c.id,
        userId: ctx.userId,
        entity: "Center",
        entityId: c.id,
        action: f.disable === "1" ? "platform.disable" : "platform.enable",
        before: { disabledAt: c.disabledAt, disabledReason: c.disabledReason },
        after: { disabledAt: after.disabledAt, disabledReason: after.disabledReason, by: ctx.userName },
      });
    });
    revalidatePath("/platform");
  });
}

export async function setCenterPlanAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(undefined, async (ctx) => {
    assertPlatform(ctx);
    const f = z.object({ centerId: z.string().min(1), plan: z.enum(PLAN_NAMES) }).parse(formObject(fd));
    const c = await db.center.findUnique({ where: { id: f.centerId }, select: { id: true, plan: true } });
    if (!c) throw new UserError("error.notFound");
    if (c.plan === f.plan) return;
    await db.$transaction(async (tx) => {
      await tx.center.update({ where: { id: c.id }, data: { plan: f.plan } });
      await audit(tx, { centerId: c.id, userId: ctx.userId, entity: "Center", entityId: c.id, action: "platform.plan", before: { plan: c.plan }, after: { plan: f.plan, by: ctx.userName } });
    });
    revalidatePath("/platform");
  });
}

/** Pilot allow-list: may this center create its own Telegram bot (managed bots)? Revoking stops its bot. */
export async function setCenterOwnBotAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction(undefined, async (ctx) => {
    assertPlatform(ctx);
    const f = z.object({ centerId: z.string().min(1), allow: z.enum(["1", "0"]) }).parse(formObject(fd));
    const c = await db.center.findUnique({ where: { id: f.centerId }, select: { id: true, ownBotAllowed: true } });
    if (!c) throw new UserError("error.notFound");
    const allow = f.allow === "1";
    if (c.ownBotAllowed === allow) return;
    await db.$transaction(async (tx) => {
      await tx.center.update({ where: { id: c.id }, data: { ownBotAllowed: allow } });
      await audit(tx, { centerId: c.id, userId: ctx.userId, entity: "Center", entityId: c.id, action: "platform.ownBot", before: { ownBotAllowed: c.ownBotAllowed }, after: { ownBotAllowed: allow, by: ctx.userName } });
    });
    revalidatePath("/platform");
  });
}
