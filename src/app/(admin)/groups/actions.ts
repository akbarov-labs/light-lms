"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { runAction, type ActionState } from "@/lib/action";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { formObject, zDate, zId, zOptDate, zOptId, zOptInt, zOptMoney, zStr } from "@/lib/forms";
import { UserError } from "@/lib/user-error";
import { assertBranch, type Ctx } from "@/lib/ctx";
import { fromISODate, monthRange, shiftMonth, toISODate, todayISO } from "@/lib/dates";
import type { Prisma } from "@/generated/prisma/client";
import { validSlot, type WeeklySlot } from "@/lib/schedule";
import { assertNoGroupClash, generateLessons, rebuildFutureLessons, trimLessonsAfter } from "@/lib/services/lessons";
import { parseGroupPrices, syncGroup } from "@/lib/billing/sync";

const schema = z.object({
  id: zOptId,
  name: zStr,
  courseId: zId,
  branchId: zId,
  teacherId: zId,
  roomId: zOptId,
  startDate: zDate,
  endDate: zOptDate,
  capacity: zOptInt(1, 1000),
  priceOverride: zOptMoney,
  priceFrom: zOptDate,
});

function readSlots(fd: FormData): WeeklySlot[] {
  const days = fd.getAll("slots.weekday").map(String);
  const starts = fd.getAll("slots.start").map(String);
  const ends = fd.getAll("slots.end").map(String);
  const slots = days
    .map((d, i) => ({ weekday: Number(d), startTime: starts[i] ?? "", endTime: ends[i] ?? "" }))
    .filter((s) => s.weekday && s.startTime && s.endTime);
  if (slots.length === 0 || !slots.every(validSlot)) throw new UserError("error.slotTime");
  return slots;
}

async function validateRefs(ctx: Ctx, f: z.infer<typeof schema>) {
  assertBranch(ctx, f.branchId);
  const [course, branch, teacher, room] = await Promise.all([
    db.course.findFirst({ where: { id: f.courseId, centerId: ctx.centerId } }),
    db.branch.findFirst({ where: { id: f.branchId, centerId: ctx.centerId } }),
    db.user.findFirst({ where: { id: f.teacherId, centerId: ctx.centerId, OR: [{ isTeacher: true }, { role: "TEACHER" }] } }),
    f.roomId ? db.room.findFirst({ where: { id: f.roomId, branchId: f.branchId } }) : Promise.resolve(null),
  ]);
  if (!course || !branch || !teacher || (f.roomId && !room)) throw new UserError("error.notFound");
  if (f.endDate && f.endDate < f.startDate) throw new UserError("error.date");
}

export async function createGroupAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const res = await runAction("groups.edit", async (ctx) => {
    const f = schema.parse(formObject(fd));
    const slots = readSlots(fd);
    await validateRefs(ctx, f);
    id = await db.$transaction(
      async (tx) => {
        await assertNoGroupClash(tx, ctx.t, { centerId: ctx.centerId, teacherId: f.teacherId, roomId: f.roomId ?? null, from: f.startDate, to: f.endDate ?? null, slots });
        const { groupSeq } = await tx.center.update({ where: { id: ctx.centerId }, data: { groupSeq: { increment: 1 } }, select: { groupSeq: true } });
        const g = await tx.group.create({
          data: {
            centerId: ctx.centerId,
            branchId: f.branchId,
            courseId: f.courseId,
            teacherId: f.teacherId,
            roomId: f.roomId ?? null,
            code: groupSeq,
            name: f.name,
            startDate: fromISODate(f.startDate),
            endDate: f.endDate ? fromISODate(f.endDate) : null,
            capacity: f.capacity ?? null,
            priceOverride: f.priceOverride ?? null,
            status: f.startDate > todayISO() ? "PLANNED" : "ACTIVE",
            slots: { create: slots },
          },
        });
        await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Group", entityId: g.id, action: "create", after: { ...g, slots } });
        await generateLessons(g.id, { tx });
        return g.id;
      },
      { timeout: 30_000 },
    );
  });
  if (res?.ok && id) redirect(`/groups/${id}`);
  return res;
}

export async function updateGroupAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id = "";
  const res = await runAction("groups.edit", async (ctx) => {
    const f = schema.parse(formObject(fd));
    if (!f.id) throw new UserError("error.notFound");
    id = f.id;
    const slots = readSlots(fd);
    await validateRefs(ctx, f);
    const g = await db.group.findFirst({ where: { id: f.id, centerId: ctx.centerId }, include: { slots: true } });
    if (!g) throw new UserError("error.notFound");
    assertBranch(ctx, g.branchId);
    const today = todayISO();
    await db.$transaction(
      async (tx) => {
        await assertNoGroupClash(tx, ctx.t, { centerId: ctx.centerId, groupId: g.id, teacherId: f.teacherId, roomId: f.roomId ?? null, from: f.startDate, to: f.endDate ?? null, slots });
        const key = (s: WeeklySlot) => `${s.weekday}|${s.startTime}|${s.endTime}`;
        const slotsChanged = g.slots.map(key).sort().join(",") !== slots.map(key).sort().join(",");
        const startChanged = toISODate(g.startDate) !== f.startDate;
        let priceHistory = parseGroupPrices(g.priceHistory);
        const newOverride = f.priceOverride ?? null;
        if (newOverride !== g.priceOverride) {
          // a new group price applies from the chosen date (default next month); charged months keep theirs
          const from = f.priceFrom ?? monthRange(shiftMonth(today.slice(0, 7), 1)).start;
          if (from < monthRange(today.slice(0, 7)).start && !ctx.can("payments.refund")) throw new UserError("enr.backdateNeedsRefund");
          if (priceHistory.length === 0) priceHistory = [{ from: "2000-01-01", price: g.priceOverride }];
          priceHistory = [...priceHistory.filter((h) => h.from < from), { from, price: newOverride }];
        }
        const updated = await tx.group.update({
          where: { id: g.id },
          data: {
            name: f.name,
            courseId: f.courseId,
            branchId: f.branchId,
            teacherId: f.teacherId,
            roomId: f.roomId ?? null,
            startDate: fromISODate(f.startDate),
            endDate: f.endDate ? fromISODate(f.endDate) : null,
            capacity: f.capacity ?? null,
            priceOverride: f.priceOverride ?? null,
            priceHistory: priceHistory as unknown as Prisma.InputJsonValue,
            ...(g.status === "PLANNED" && f.startDate <= today ? { status: "ACTIVE" as const } : {}),
            ...(g.status === "FINISHED" && (!f.endDate || f.endDate >= today) ? { status: "ACTIVE" as const } : {}),
          },
        });
        if (slotsChanged) {
          await tx.groupSlot.deleteMany({ where: { groupId: g.id } });
          await tx.groupSlot.createMany({ data: slots.map((s) => ({ ...s, groupId: g.id })) });
        }
        // Future lessons follow the new teacher / room unless someone set a substitute by hand.
        if (g.teacherId !== f.teacherId) {
          await tx.lesson.updateMany({ where: { groupId: g.id, date: { gte: fromISODate(today) }, status: "SCHEDULED", teacherId: g.teacherId }, data: { teacherId: f.teacherId } });
        }
        if (g.roomId !== (f.roomId ?? null)) {
          await tx.lesson.updateMany({ where: { groupId: g.id, date: { gte: fromISODate(today) }, status: "SCHEDULED", roomId: g.roomId }, data: { roomId: f.roomId ?? null } });
        }
        if (slotsChanged) await rebuildFutureLessons(g.id, today, tx);
        if (startChanged && f.startDate > toISODate(g.startDate)) {
          await tx.lesson.deleteMany({ where: { groupId: g.id, date: { lt: fromISODate(f.startDate) }, status: "SCHEDULED", attendance: { none: {} } } });
        }
        if (f.endDate) await trimLessonsAfter(g.id, f.endDate, tx);
        await generateLessons(g.id, { tx });
        await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Group", entityId: g.id, action: "update", before: g, after: { ...updated, slots } });
      },
      { timeout: 30_000 },
    );
    await syncGroup(g.id, { userId: ctx.userId });
  });
  if (res?.ok && id) redirect(`/groups/${id}`);
  return res;
}

export async function setGroupStatusAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("groups.edit", async (ctx) => {
    const id = zId.parse(fd.get("id"));
    const status = z.enum(["ACTIVE", "FINISHED", "ARCHIVED"]).parse(fd.get("status"));
    if (status === "ARCHIVED" && !ctx.can("archive")) throw new UserError("error.forbidden");
    const g = await db.group.findFirst({ where: { id, centerId: ctx.centerId } });
    if (!g) throw new UserError("error.notFound");
    assertBranch(ctx, g.branchId);
    await db.$transaction(async (tx) => {
      await tx.group.update({ where: { id }, data: { status } });
      if (status !== "ACTIVE") {
        // no more lessons after today for a finished/archived group
        const today = todayISO();
        await tx.lesson.deleteMany({ where: { groupId: id, date: { gt: fromISODate(today) }, status: "SCHEDULED", attendance: { none: {} } } });
        if (!g.endDate) await tx.group.update({ where: { id }, data: { endDate: fromISODate(today) } });
      }
      await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Group", entityId: id, action: `status.${status}`, before: { status: g.status } });
    });
    if (status === "ACTIVE") await generateLessons(id);
    await syncGroup(id, { userId: ctx.userId });
    revalidatePath(`/groups/${id}`);
  });
}

