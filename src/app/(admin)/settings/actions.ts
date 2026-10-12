"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import bcrypt from "bcryptjs";
import type { Prisma } from "@prisma/client";
import { runAction, type ActionState } from "@/lib/action";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { formList, formObject, zBool, zDate, zId, zOptId, zOptInt, zOptStr, zPhone, zStr } from "@/lib/forms";
import { UserError } from "@/lib/user-error";
import { assertNotDemo } from "@/lib/demo-guard";
import { DEFAULT_PERMS, PERMS, type Perm, type RoleName } from "@/lib/perms";
import { readSettings } from "@/lib/settings";
import { fromISODate } from "@/lib/dates";
import { generateLessons } from "@/lib/services/lessons";
import { syncGroup } from "@/lib/billing/sync";
import { assertBranch, staffInScope, type Ctx } from "@/lib/ctx";
import { adminResetPassword, BCRYPT_ROUNDS, setPassword } from "@/lib/auth/password";
import { MIN_PASSWORD } from "@/lib/auth/security";
import { issueSession } from "@/lib/auth/session-cookie";

// ---------------------------------------------------------------- center

const centerSchema = z.object({
  name: zStr,
  slug: z.preprocess((v) => (typeof v === "string" ? v.toLowerCase() : v), z.string().regex(/^[a-z0-9-]{2,40}$/)),
  accentColor: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  logoUrl: zOptStr,
  phone: zOptStr,
  locale: z.enum(["uz", "ru"]),
  trialLessons: zOptInt(0, 10),
  reminderDaysBefore: zOptInt(0, 15),
  lessonsAheadDays: zOptInt(31, 180),
  gradeScale: z.enum(["5", "100"]),
  excusedAbsenceCredit: zBool,
  payTeacherForTrial: zBool,
  payFromCollected: zBool,
  transferAsTrial: zBool,
  paymeMerchantId: zOptStr,
  paymeKey: zOptStr,
  paymeTestMode: zBool,
});

const NOTIFY = ["payment", "reminder", "debt", "absence", "trial", "teacherReminder", "dailyReport"] as const;

export async function saveCenterAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("settings", async (ctx) => {
    assertNotDemo();
    const f = centerSchema.parse(formObject(fd));
    const clash = await db.center.findFirst({ where: { slug: f.slug, id: { not: ctx.centerId } } });
    if (clash) throw new UserError("settings.slugTaken");
    const before = await db.center.findUniqueOrThrow({ where: { id: ctx.centerId } });
    const old = readSettings(before.settings);
    const settings = {
      ...old,
      trialLessons: f.trialLessons ?? old.trialLessons,
      reminderDaysBefore: f.reminderDaysBefore ?? old.reminderDaysBefore,
      lessonsAheadDays: f.lessonsAheadDays ?? old.lessonsAheadDays,
      gradeScale: f.gradeScale,
      excusedAbsenceCredit: f.excusedAbsenceCredit,
      payTeacherForTrial: f.payTeacherForTrial,
      payFromCollected: f.payFromCollected,
      transferAsTrial: f.transferAsTrial,
      expenseCategories: (() => {
        const list = String(fd.get("expenseCategories") ?? "").split("\n").map((x) => x.trim()).filter(Boolean).slice(0, 50);
        return list.length ? [...new Set(list)] : old.expenseCategories;
      })(),
      notify: Object.fromEntries(NOTIFY.map((k) => [k, fd.get(`notify.${k}`) === "on"])) as typeof old.notify,
    };
    await db.$transaction(async (tx) => {
      const after = await tx.center.update({
        where: { id: ctx.centerId },
        data: {
          name: f.name,
          slug: f.slug,
          accentColor: f.accentColor,
          logoUrl: f.logoUrl ?? null,
          phone: f.phone ?? null,
          locale: f.locale,
          settings: settings as unknown as Prisma.InputJsonValue,
          paymeMerchantId: f.paymeMerchantId ?? null,
          // keep the stored key when the field is left empty (it is never shown back)
          paymeKey: f.paymeKey === "-" ? null : (f.paymeKey ?? before.paymeKey),
          paymeTestMode: f.paymeTestMode,
        },
      });
      await audit(tx, {
        centerId: ctx.centerId,
        userId: ctx.userId,
        entity: "Center",
        entityId: ctx.centerId,
        action: "settings",
        before: { ...before, paymeKey: before.paymeKey ? "***" : null },
        after: { ...after, paymeKey: after.paymeKey ? "***" : null },
      });
    });
    revalidatePath("/", "layout");
    return { message: ctx.t("common.saved") };
  });
}

// ---------------------------------------------------------------- branches & rooms

const branchSchema = z.object({ id: zOptId, name: zStr, address: zOptStr, phone: zOptStr });

export async function saveBranchAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("settings", async (ctx) => {
    const f = branchSchema.parse(formObject(fd));
    await db.$transaction(async (tx) => {
      if (f.id) {
        const b = await tx.branch.findFirst({ where: { id: f.id, centerId: ctx.centerId } });
        if (!b) throw new UserError("error.notFound");
        const after = await tx.branch.update({ where: { id: b.id }, data: { name: f.name, address: f.address ?? null, phone: f.phone ?? null } });
        await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Branch", entityId: b.id, action: "update", before: b, after });
      } else {
        const b = await tx.branch.create({ data: { centerId: ctx.centerId, name: f.name, address: f.address ?? null, phone: f.phone ?? null } });
        await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Branch", entityId: b.id, action: "create", after: b });
      }
    });
    revalidatePath("/settings/branches");
  });
}

export async function toggleBranchArchiveAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("settings", async (ctx) => {
    const id = zId.parse(fd.get("id"));
    const b = await db.branch.findFirst({ where: { id, centerId: ctx.centerId } });
    if (!b) throw new UserError("error.notFound");
    await db.$transaction(async (tx) => {
      await tx.branch.update({ where: { id }, data: { archivedAt: b.archivedAt ? null : new Date() } });
      await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Branch", entityId: id, action: b.archivedAt ? "restore" : "archive" });
    });
    revalidatePath("/settings/branches");
  });
}

const roomSchema = z.object({ id: zOptId, branchId: zId, name: zStr, capacity: zOptInt(1, 1000) });

export async function saveRoomAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("settings", async (ctx) => {
    const f = roomSchema.parse(formObject(fd));
    const branch = await db.branch.findFirst({ where: { id: f.branchId, centerId: ctx.centerId } });
    if (!branch) throw new UserError("error.notFound");
    if (f.id) {
      const r = await db.room.findFirst({ where: { id: f.id, branch: { centerId: ctx.centerId } } });
      if (!r) throw new UserError("error.notFound");
      await db.room.update({ where: { id: r.id }, data: { name: f.name, capacity: f.capacity ?? null } });
    } else {
      await db.room.create({ data: { branchId: branch.id, name: f.name, capacity: f.capacity ?? null } });
    }
    revalidatePath("/settings/branches");
  });
}

export async function toggleRoomArchiveAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("settings", async (ctx) => {
    const id = zId.parse(fd.get("id"));
    const r = await db.room.findFirst({ where: { id, branch: { centerId: ctx.centerId } } });
    if (!r) throw new UserError("error.notFound");
    await db.room.update({ where: { id }, data: { archivedAt: r.archivedAt ? null : new Date() } });
    revalidatePath("/settings/branches");
  });
}

// ---------------------------------------------------------------- holidays

export async function addHolidayAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("settings", async (ctx) => {
    const f = z.object({ date: zDate, name: zStr }).parse(formObject(fd));
    const affected = await db.$transaction(async (tx) => {
      const h = await tx.holiday.upsert({
        where: { centerId_date: { centerId: ctx.centerId, date: fromISODate(f.date) } },
        create: { centerId: ctx.centerId, date: fromISODate(f.date), name: f.name },
        update: { name: f.name },
      });
      // lessons already generated on that day: drop the ones nothing depends on
      const lessons = await tx.lesson.findMany({
        where: { date: fromISODate(f.date), group: { centerId: ctx.centerId }, status: "SCHEDULED", attendance: { none: {} } },
        select: { id: true, groupId: true },
      });
      await tx.lesson.deleteMany({ where: { id: { in: lessons.map((l) => l.id) } } });
      await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Holiday", entityId: h.id, action: "create", after: { ...h, removedLessons: lessons.length } });
      return [...new Set(lessons.map((l) => l.groupId))];
    });
    for (const g of affected) await syncGroup(g, { userId: ctx.userId });
    revalidatePath("/settings/holidays");
  });
}

export async function removeHolidayAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("settings", async (ctx) => {
    const id = zId.parse(fd.get("id"));
    const h = await db.holiday.findFirst({ where: { id, centerId: ctx.centerId } });
    if (!h) throw new UserError("error.notFound");
    await db.$transaction(async (tx) => {
      await tx.holiday.delete({ where: { id } });
      await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Holiday", entityId: id, action: "delete", before: h });
    });
    // lessons come back on that day for groups whose schedule has it
    const groups = await db.group.findMany({ where: { centerId: ctx.centerId, status: { in: ["ACTIVE", "PLANNED"] } }, select: { id: true } });
    for (const g of groups) {
      if ((await generateLessons(g.id)) > 0) await syncGroup(g.id, { userId: ctx.userId });
    }
    revalidatePath("/settings/holidays");
  });
}

// ---------------------------------------------------------------- staff

const staffSchema = z.object({
  id: zOptId,
  name: zStr,
  phone: zPhone,
  role: z.enum(["OWNER", "MANAGER", "ADMIN", "TEACHER"]),
  isTeacher: zBool,
  password: zOptStr,
});

function canManageRole(ctx: Ctx, role: RoleName): boolean {
  if (ctx.role === "OWNER") return true;
  return role === "ADMIN" || role === "TEACHER";
}

export async function saveStaffAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("staff.manage", async (ctx) => {
    assertNotDemo();
    const f = staffSchema.parse(formObject(fd));
    if (!canManageRole(ctx, f.role)) throw new UserError("settings.cannotEditOwner");
    const perms = formList(fd, "perms").filter((p): p is Perm => (PERMS as readonly string[]).includes(p));
    // A manager can only hand out switches they have themselves.
    const grantable = perms.filter((p) => ctx.role === "OWNER" || ctx.can(p));
    const branchIds = formList(fd, "branchIds");
    const branches = await db.branch.findMany({ where: { id: { in: branchIds }, centerId: ctx.centerId }, select: { id: true } });
    for (const b of branches) assertBranch(ctx, b.id);
    if (f.password && f.password.length < MIN_PASSWORD) throw new UserError("settings.passwordShort");

    const taken = await db.user.findUnique({ where: { phone: f.phone } });
    if (taken && taken.id !== f.id) throw new UserError("error.phoneTaken");

    await db.$transaction(async (tx) => {
      const data = {
        name: f.name,
        phone: f.phone,
        role: f.role,
        isTeacher: f.role === "TEACHER" ? true : f.isTeacher,
        perms: f.role === "OWNER" ? [...PERMS] : f.role === "TEACHER" ? [] : fd.has("permsTouched") ? grantable : DEFAULT_PERMS[f.role],
      };
      let userId: string;
      if (f.id) {
        const u = await tx.user.findFirst({ where: { id: f.id, centerId: ctx.centerId }, include: { branches: true } });
        if (!u) throw new UserError("error.notFound");
        if (!canManageRole(ctx, u.role as RoleName)) throw new UserError("settings.cannotEditOwner");
        // a branch manager edits only staff who work entirely inside their branches
        if (!staffInScope(ctx, u.branches.map((b) => b.branchId))) throw new UserError("error.forbidden");
        if (u.id === ctx.userId && f.role !== u.role) throw new UserError("settings.cannotEditOwner");
        await tx.user.update({ where: { id: u.id }, data });
        // a password typed by an admin is a reset: old sessions end, the user picks their own next time
        if (f.password) await setPassword(tx, { id: u.id, phone: f.phone }, f.password, { mustChange: u.id !== ctx.userId });
        await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "User", entityId: u.id, action: "update", before: { ...u, passwordHash: undefined }, after: { ...data, branchIds, passwordChanged: !!f.password } });
        userId = u.id;
      } else {
        if (!f.password) throw new UserError("settings.passwordShort");
        const u = await tx.user.create({ data: { ...data, centerId: ctx.centerId, passwordHash: await bcrypt.hash(f.password, BCRYPT_ROUNDS), mustChangePassword: true } });
        await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "User", entityId: u.id, action: "create", after: { ...data, branchIds } });
        userId = u.id;
      }
      // replace only the branch assignments this user controls
      await tx.userBranch.deleteMany({ where: { userId, ...(ctx.branchIds ? { branchId: { in: ctx.branchIds } } : {}) } });
      if (branches.length) await tx.userBranch.createMany({ data: branches.map((b) => ({ userId, branchId: b.id })), skipDuplicates: true });
    });
    // own password changed here: other sessions end, this one gets a fresh token
    if (f.id === ctx.userId && f.password) await issueSession({ sub: ctx.userId, cid: ctx.centerId });
    revalidatePath("/settings/staff");
  });
}

export async function toggleStaffArchiveAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("staff.manage", async (ctx) => {
    assertNotDemo();
    const id = zId.parse(fd.get("id"));
    if (id === ctx.userId) throw new UserError("settings.cannotArchiveSelf");
    const u = await db.user.findFirst({ where: { id, centerId: ctx.centerId }, include: { branches: true } });
    if (!u) throw new UserError("error.notFound");
    if (!canManageRole(ctx, u.role as RoleName)) throw new UserError("settings.cannotEditOwner");
    if (!staffInScope(ctx, u.branches.map((b) => b.branchId))) throw new UserError("error.forbidden");
    await db.$transaction(async (tx) => {
      await tx.user.update({ where: { id }, data: { archivedAt: u.archivedAt ? null : new Date() } });
      await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "User", entityId: id, action: u.archivedAt ? "restore" : "archive" });
    });
    revalidatePath("/settings/staff");
  });
}

/** Owner/manager: replace a staff member's password with a one-time temporary one (shown once). */
export async function resetStaffPasswordAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("staff.manage", async (ctx) => {
    assertNotDemo();
    const id = zId.parse(fd.get("id"));
    if (id === ctx.userId) throw new UserError("settings.cannotResetSelf");
    const u = await db.user.findFirst({ where: { id, centerId: ctx.centerId, archivedAt: null }, include: { branches: true } });
    if (!u) throw new UserError("error.notFound");
    if (!canManageRole(ctx, u.role as RoleName)) throw new UserError("settings.cannotEditOwner");
    if (!staffInScope(ctx, u.branches.map((b) => b.branchId))) throw new UserError("error.forbidden");
    const temp = await adminResetPassword(ctx, u);
    return { message: ctx.t("settings.tempPassword", { password: temp }) };
  });
}
