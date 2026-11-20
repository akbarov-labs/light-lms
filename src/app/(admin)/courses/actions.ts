"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { runAction, type ActionState } from "@/lib/action";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { formObject, zId, zMoney, zOptDate, zOptId, zOptInt, zOptStr, zStr } from "@/lib/forms";
import { UserError } from "@/lib/user-error";
import { parsePriceHistory, syncGroup } from "@/lib/billing/sync";
import { monthRange, shiftMonth, todayISO } from "@/lib/dates";

const schema = z.object({
  id: zOptId,
  name: zStr,
  level: zOptStr,
  description: zOptStr,
  lessonMinutes: zOptInt(15, 600),
  lessonsPerWeek: zOptInt(1, 21),
  durationMonths: zOptInt(1, 60),
  pricingType: z.enum(["SUBSCRIPTION", "PACKAGE"]),
  price: zMoney,
  renewal: z.enum(["CALENDAR", "GROUP_START", "STUDENT_START"]).default("CALENDAR"),
  renewalDay: zOptInt(1, 28),
  packageLessons: zOptInt(1, 1000),
  installments: zOptInt(1, 24),
  priceFrom: zOptDate,
});

export async function saveCourseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("groups.edit", async (ctx) => {
    const f = schema.parse(formObject(fd));
    const data = {
      name: f.name,
      level: f.level ?? null,
      description: f.description ?? null,
      lessonMinutes: f.lessonMinutes ?? 90,
      lessonsPerWeek: f.lessonsPerWeek ?? null,
      durationMonths: f.durationMonths ?? null,
      pricingType: f.pricingType,
      renewal: f.renewal,
      renewalDay: f.pricingType === "SUBSCRIPTION" && f.renewal === "CALENDAR" ? (f.renewalDay ?? 1) : 1,
      packageLessons: f.pricingType === "PACKAGE" ? (f.packageLessons ?? null) : null,
      installments: f.pricingType === "PACKAGE" ? (f.installments ?? 1) : 1,
    };
    let resync: string[] = [];
    await db.$transaction(async (tx) => {
      if (!f.id) {
        const c = await tx.course.create({ data: { ...data, centerId: ctx.centerId, price: f.price } });
        await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Course", entityId: c.id, action: "create", after: c });
        return;
      }
      const c = await tx.course.findFirst({ where: { id: f.id, centerId: ctx.centerId } });
      if (!c) throw new UserError("error.notFound");
      const used = await tx.enrollment.count({ where: { group: { courseId: c.id } } });
      const billingShapeChanged =
        c.pricingType !== data.pricingType || c.renewal !== data.renewal || c.renewalDay !== data.renewalDay || c.packageLessons !== data.packageLessons || c.installments !== data.installments;
      if (used > 0 && billingShapeChanged) throw new UserError("courses.locked");
      let history = parsePriceHistory(c.priceHistory);
      if (f.price !== c.price) {
        // new price applies from the chosen date (default: next month); earlier units keep the old price
        const from = f.priceFrom ?? monthRange(shiftMonth(todayISO().slice(0, 7), 1)).start;
        if (from < monthRange(todayISO().slice(0, 7)).start && !ctx.can("payments.refund")) throw new UserError("enr.backdateNeedsRefund");
        if (history.length === 0) history = [{ from: "2000-01-01", price: c.price }];
        history = [...history.filter((h) => h.from < from), { from, price: f.price }];
      }
      const updated = await tx.course.update({ where: { id: c.id }, data: { ...data, price: f.price, priceHistory: history as unknown as Prisma.InputJsonValue } });
      await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Course", entityId: c.id, action: "update", before: c, after: updated });
      if (f.price !== c.price || billingShapeChanged) {
        resync = (await tx.group.findMany({ where: { courseId: c.id }, select: { id: true } })).map((g) => g.id);
      }
    });
    for (const g of resync) await syncGroup(g, { userId: ctx.userId });
    revalidatePath("/courses");
  });
}

export async function toggleCourseArchiveAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("groups.edit", async (ctx) => {
    const id = zId.parse(fd.get("id"));
    const c = await db.course.findFirst({ where: { id, centerId: ctx.centerId } });
    if (!c) throw new UserError("error.notFound");
    await db.$transaction(async (tx) => {
      await tx.course.update({ where: { id }, data: { archivedAt: c.archivedAt ? null : new Date() } });
      await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Course", entityId: id, action: c.archivedAt ? "restore" : "archive" });
    });
    revalidatePath("/courses");
  });
}
