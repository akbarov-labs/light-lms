"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { runAction, type ActionState } from "@/lib/action";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { assertBranch, assertLeadRefs, type Ctx } from "@/lib/ctx";
import { formObject, zId, zOptDate, zOptId, zOptPhone, zOptStr, zStr, zTags } from "@/lib/forms";
import { sendStaffMessage, STAFF_MESSAGE_MAX } from "@/lib/agent/service";
import { UserError } from "@/lib/user-error";
import { fromISODate } from "@/lib/dates";

const STAGES = ["NEW", "CONTACTED", "TRIAL_BOOKED", "TRIAL_DONE", "ENROLLED", "LOST"] as const;

async function loadLead(ctx: Ctx, id: string) {
  const lead = await db.lead.findFirst({ where: { id, centerId: ctx.centerId } });
  if (!lead) throw new UserError("error.notFound");
  if (lead.branchId) assertBranch(ctx, lead.branchId);
  return lead;
}

const leadSchema = z.object({
  id: zOptId,
  name: zStr,
  // optional only for a Telegram AI lead that has none yet: a phone can be added, never removed
  phone: zOptPhone,
  source: zOptStr,
  courseId: zOptId,
  branchId: zOptId,
  assignedToId: zOptId,
  nextContactAt: zOptDate,
  tags: zTags,
  note: zOptStr,
});

export async function saveLeadAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("leads", async (ctx) => {
    const f = leadSchema.parse(formObject(fd));
    const existing = f.id ? await loadLead(ctx, f.id) : null;
    if (!f.phone && (!existing || existing.phone)) throw new UserError("leads.phoneRequired");
    await assertLeadRefs(ctx, f, existing);
    const data = {
      name: f.name,
      phone: f.phone ?? null,
      source: f.source ?? null,
      courseId: f.courseId ?? null,
      branchId: f.branchId ?? ctx.activeBranchId ?? ctx.branchIds?.[0] ?? null,
      assignedToId: f.assignedToId ?? null,
      nextContactAt: f.nextContactAt ? fromISODate(f.nextContactAt) : null,
      tags: f.tags,
    };
    await db.$transaction(async (tx) => {
      if (existing) {
        const after = await tx.lead.update({ where: { id: existing.id }, data });
        await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Lead", entityId: existing.id, action: "update", before: existing, after });
      } else {
        const lead = await tx.lead.create({ data: { ...data, centerId: ctx.centerId, assignedToId: data.assignedToId ?? ctx.userId } });
        if (f.note) await tx.leadNote.create({ data: { leadId: lead.id, text: f.note, createdById: ctx.userId } });
        await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Lead", entityId: lead.id, action: "create", after: lead });
      }
    });
    revalidatePath("/leads");
    if (f.id) revalidatePath(`/leads/${f.id}`);
  });
}

export async function moveLeadAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("leads", async (ctx) => {
    const f = z.object({ id: zId, stage: z.enum(STAGES), lostReason: zOptStr }).parse(formObject(fd));
    const lead = await loadLead(ctx, f.id);
    if (f.stage === "LOST" && !f.lostReason) throw new UserError("error.lostReason");
    await db.$transaction(async (tx) => {
      await tx.lead.update({ where: { id: lead.id }, data: { stage: f.stage, lostReason: f.stage === "LOST" ? f.lostReason : null } });
      if (f.stage === "LOST") await tx.leadNote.create({ data: { leadId: lead.id, text: `✕ ${f.lostReason}`, createdById: ctx.userId } });
      await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Lead", entityId: lead.id, action: `stage.${f.stage}`, before: { stage: lead.stage }, after: { stage: f.stage, lostReason: f.lostReason } });
    });
    revalidatePath("/leads");
    revalidatePath(`/leads/${lead.id}`);
  });
}

export async function addLeadNoteAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("leads", async (ctx) => {
    const f = z.object({ id: zId, text: zStr, nextContactAt: zOptDate }).parse(formObject(fd));
    const lead = await loadLead(ctx, f.id);
    await db.$transaction(async (tx) => {
      await tx.leadNote.create({ data: { leadId: lead.id, text: f.text, createdById: ctx.userId } });
      const patch: Prisma.LeadUpdateInput = {};
      if (f.nextContactAt) patch.nextContactAt = fromISODate(f.nextContactAt);
      if (lead.stage === "NEW") patch.stage = "CONTACTED";
      if (Object.keys(patch).length) await tx.lead.update({ where: { id: lead.id }, data: patch });
    });
    revalidatePath(`/leads/${lead.id}`);
  });
}

export async function toggleLeadArchiveAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("leads", async (ctx) => {
    const lead = await loadLead(ctx, zId.parse(fd.get("id")));
    await db.$transaction(async (tx) => {
      await tx.lead.update({ where: { id: lead.id }, data: { archivedAt: lead.archivedAt ? null : new Date() } });
      await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Lead", entityId: lead.id, action: lead.archivedAt ? "restore" : "archive" });
    });
    revalidatePath("/leads");
    revalidatePath(`/leads/${lead.id}`);
  });
}

/** Write to a Telegram AI lead through the bot (the agent then continues knowing what was said). */
export async function sendLeadTelegramAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("leads", async (ctx) => {
    const f = z.object({ id: zId, chatId: zId, text: z.string().trim().min(1).max(STAFF_MESSAGE_MAX) }).parse(formObject(fd));
    const lead = await loadLead(ctx, f.id);
    const chat = await db.agentChat.findFirst({ where: { id: f.chatId, centerId: ctx.centerId, leadId: lead.id }, select: { id: true } });
    if (!chat) throw new UserError("error.notFound");
    const me = await db.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { name: true } });
    await sendStaffMessage({ centerId: ctx.centerId, chatRowId: chat.id, userId: ctx.userId, staffName: me.name, text: f.text });
    revalidatePath(`/leads/${lead.id}`);
    revalidatePath("/leads");
  });
}
