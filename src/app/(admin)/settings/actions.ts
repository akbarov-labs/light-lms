"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import bcrypt from "bcryptjs";
import type { Prisma } from "@/generated/prisma/client";
import { isUniqueViolation } from "@/lib/db-errors";
import { runAction, type ActionState } from "@/lib/action";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { formList, formObject, zBool, zDate, zId, zOptId, zOptInt, zOptStr, zPhone, zStr } from "@/lib/forms";
import { UserError } from "@/lib/user-error";
import { assertNotDemo } from "@/lib/demo-guard";
import { PERMS, type Perm, type RoleName } from "@/lib/perms";
import { paymeFiscalSchema, readSettings, SMS_EVENTS, type PaymeFiscal } from "@/lib/settings";
import { enqueueSms } from "@/lib/notify";
import { fromISODate } from "@/lib/dates";
import { generateLessons } from "@/lib/services/lessons";
import { syncGroup } from "@/lib/billing/sync";
import { assertBranch, staffInScope, staffPermsFor, type Ctx } from "@/lib/ctx";
import { parseGeo } from "@/lib/geo";

/** Teacher bio length: enough for experience and results, short enough for every agent prompt. */
const BIO_MAX = 600;
import { adminResetPassword, BCRYPT_ROUNDS, setPassword } from "@/lib/auth/password";
import { MIN_PASSWORD } from "@/lib/auth/security";
import { issueSession } from "@/lib/auth/session-cookie";
import { unlinkIfPhoneChanged, unlinkRef } from "@/lib/telegram-links";

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
  fiscalIkpu: zOptStr,
  fiscalPackageCode: zOptStr,
  fiscalVat: zOptStr,
  clickServiceId: zOptStr,
  clickMerchantId: zOptStr,
  clickSecretKey: zOptStr,
  uzumServiceId: zOptStr,
  uzumLogin: zOptStr,
  uzumPassword: zOptStr,
  reportCardsAuto: zBool,
  reportCardsDay: zOptInt(1, 28),
  weeklyReport: zBool,
  weeklyDay: zOptInt(1, 7),
  weeklyHour: zOptInt(8, 22),
  homeworkEnabled: zBool,
  homeworkDirectFromGrade: zOptInt(1, 12),
  homeworkDueMinutes: zOptInt(0, 720),
  homeworkLateDays: zOptInt(0, 7),
  homeworkAttempts: zOptInt(0, 5),
  homeworkRemindHours: zOptInt(0, 48),
  homeworkPhotos: zBool,
  tutorEnabled: zBool,
  tutorDailyMessages: zOptInt(1, 200),
  dailyReportHour: zOptInt(6, 23),
  smsLogin: zOptStr,
  smsPassword: zOptStr,
  smsFrom: z.preprocess((v) => (typeof v === "string" && v.trim() === "" ? undefined : v), z.string().trim().max(11).optional()),
});

/** Secret fields are never shown back: empty keeps the stored value, "-" removes it. */
const keepSecret = (typed: string | undefined, stored: string | null) => (typed === "-" ? null : (typed ?? stored));
const mask = <T extends Record<string, unknown>>(c: T) => ({
  ...c,
  paymeKey: c.paymeKey ? "***" : null,
  clickSecretKey: c.clickSecretKey ? "***" : null,
  uzumPassword: c.uzumPassword ? "***" : null,
  smsPassword: c.smsPassword ? "***" : null,
});

/** All three fiscal fields empty → no fiscal receipt; otherwise they must form a valid PaymeFiscal. */
function parseFiscal(f: { fiscalIkpu?: string; fiscalPackageCode?: string; fiscalVat?: string }): PaymeFiscal | null {
  if (!f.fiscalIkpu && !f.fiscalPackageCode && !f.fiscalVat) return null;
  const vat = f.fiscalVat === undefined ? NaN : Number(f.fiscalVat.replace(",", "."));
  const r = paymeFiscalSchema.safeParse({ ikpu: (f.fiscalIkpu ?? "").replace(/\s/g, ""), packageCode: f.fiscalPackageCode ?? "", vatPercent: vat });
  if (!r.success) throw new UserError("settings.paymeFiscalInvalid");
  return r.data;
}

const NOTIFY = ["payment", "reminder", "debt", "debtDaily", "absence", "trial", "teacherReminder", "dailyReport", "reportCard", "examResult"] as const;

export async function saveCenterAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("settings", async (ctx) => {
    assertNotDemo();
    const f = centerSchema.parse(formObject(fd));
    const clash = await db.center.findFirst({ where: { slug: f.slug, id: { not: ctx.centerId } } });
    if (clash) throw new UserError("settings.slugTaken");
    const before = await db.center.findUniqueOrThrow({ where: { id: ctx.centerId } });
    // one Payme cashbox key = one center (unique index): Payme requests are routed by the key
    const paymeKey = f.paymeKey === "-" ? null : (f.paymeKey ?? before.paymeKey);
    if (paymeKey && (await db.center.findFirst({ where: { paymeKey, id: { not: ctx.centerId } }, select: { id: true } }))) throw new UserError("settings.paymeKeyTaken");
    const paymeFiscal = parseFiscal(f);
    // Click / Uzum route callbacks by service id: one service = one center (unique index)
    for (const [field, value] of [["clickServiceId", f.clickServiceId], ["uzumServiceId", f.uzumServiceId]] as const) {
      if (value && (await db.center.findFirst({ where: { [field]: value, id: { not: ctx.centerId } }, select: { id: true } }))) throw new UserError("settings.serviceTaken");
    }
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
      paymeFiscal,
      reportCards: { autoSend: f.reportCardsAuto, sendDay: f.reportCardsDay ?? old.reportCards.sendDay },
      makeupWeekdays: (() => {
        const days = formList(fd, "makeupDays").map(Number).filter((d) => Number.isInteger(d) && d >= 1 && d <= 7);
        return days.length ? [...new Set(days)].sort() : old.makeupWeekdays;
      })(),
      parentReports: { weekly: f.weeklyReport, weekday: f.weeklyDay ?? old.parentReports.weekday, hour: f.weeklyHour ?? old.parentReports.hour },
      homework: {
        enabled: f.homeworkEnabled,
        directFromGrade: f.homeworkDirectFromGrade ?? old.homework.directFromGrade,
        dueMinutesBefore: f.homeworkDueMinutes ?? old.homework.dueMinutesBefore,
        lateDays: f.homeworkLateDays ?? old.homework.lateDays,
        attempts: f.homeworkAttempts ?? old.homework.attempts,
        remindHoursBefore: f.homeworkRemindHours ?? old.homework.remindHoursBefore,
        photos: f.homeworkPhotos,
      },
      tutor: { enabled: f.tutorEnabled, dailyMessages: f.tutorDailyMessages ?? old.tutor.dailyMessages },
      dailyReportHour: f.dailyReportHour ?? old.dailyReportHour,
      sms: { ...Object.fromEntries(SMS_EVENTS.map((k) => [k, fd.get(`sms.${k}`) === "on"])), onlyWithoutTelegram: fd.get("sms.onlyWithoutTelegram") === "on" } as typeof old.sms,
    };
    await db
      .$transaction(async (tx) => {
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
            paymeKey,
            paymeTestMode: f.paymeTestMode,
            clickServiceId: f.clickServiceId ?? null,
            clickMerchantId: f.clickMerchantId ?? null,
            clickSecretKey: keepSecret(f.clickSecretKey, before.clickSecretKey),
            uzumServiceId: f.uzumServiceId ?? null,
            uzumLogin: f.uzumLogin ?? null,
            uzumPassword: keepSecret(f.uzumPassword, before.uzumPassword),
            smsLogin: f.smsLogin ?? null,
            smsPassword: keepSecret(f.smsPassword, before.smsPassword),
            smsFrom: f.smsFrom ?? null,
          },
        });
        await audit(tx, {
          centerId: ctx.centerId,
          userId: ctx.userId,
          entity: "Center",
          entityId: ctx.centerId,
          action: "settings",
          before: mask(before),
          after: mask(after),
        });
      })
      .catch((e: unknown) => {
        // lost a race with another center saving the same key (unique index)
        if (isUniqueViolation(e, "paymeKey")) throw new UserError("settings.paymeKeyTaken");
        if (isUniqueViolation(e, "clickServiceId") || isUniqueViolation(e, "uzumServiceId")) throw new UserError("settings.serviceTaken");
        throw e;
      });
    revalidatePath("/", "layout");
    if (fd.get("intent") === "smsTest") return { message: await queueTestSms(ctx) };
    return { message: ctx.t("common.saved") };
  });
}

/** One SMS to the signed-in user's own phone, through the queue like every other SMS. */
async function queueTestSms(ctx: Ctx): Promise<string> {
  const c = await db.center.findUniqueOrThrow({ where: { id: ctx.centerId }, select: { smsLogin: true, smsPassword: true } });
  if (!c.smsLogin || !c.smsPassword) throw new UserError("settings.smsNotConfigured");
  const me = await db.user.findUniqueOrThrow({ where: { id: ctx.userId }, select: { phone: true } });
  await db.$transaction(async (tx) => {
    // Eskiz test accounts accept only its own sample texts; this is one of them
    await enqueueSms(tx, ctx.centerId, { phone: me.phone, locale: ctx.locale }, () => ctx.t("settings.smsTestText"));
    await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Center", entityId: ctx.centerId, action: "sms.test", after: { phone: me.phone } });
  });
  return ctx.t("settings.smsTestSent", { phone: me.phone });
}

// ---------------------------------------------------------------- branches & rooms

const branchSchema = z.object({ id: zOptId, name: zStr, address: zOptStr, phone: zOptStr, location: zOptStr });

/** The map point from coordinates or a full map link; empty clears it. */
function branchPoint(location: string | undefined): { latitude: number | null; longitude: number | null } {
  if (!location) return { latitude: null, longitude: null };
  const r = parseGeo(location);
  if (!r.ok) throw new UserError(r.reason === "short_link" ? "settings.locationShortLink" : "settings.locationInvalid");
  return { latitude: r.point.lat, longitude: r.point.lng };
}

export async function saveBranchAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return runAction("settings", async (ctx) => {
    const f = branchSchema.parse(formObject(fd));
    await db.$transaction(async (tx) => {
      if (f.id) {
        const b = await tx.branch.findFirst({ where: { id: f.id, centerId: ctx.centerId } });
        if (!b) throw new UserError("error.notFound");
        const after = await tx.branch.update({ where: { id: b.id }, data: { name: f.name, address: f.address ?? null, phone: f.phone ?? null, ...branchPoint(f.location) } });
        await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Branch", entityId: b.id, action: "update", before: b, after });
      } else {
        const b = await tx.branch.create({ data: { centerId: ctx.centerId, name: f.name, address: f.address ?? null, phone: f.phone ?? null, ...branchPoint(f.location) } });
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
  bio: zOptStr,
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
    const picked = fd.has("permsTouched") ? formList(fd, "perms").filter((p): p is Perm => (PERMS as readonly string[]).includes(p)) : null;
    const branchIds = formList(fd, "branchIds");
    const branches = await db.branch.findMany({ where: { id: { in: branchIds }, centerId: ctx.centerId }, select: { id: true } });
    for (const b of branches) assertBranch(ctx, b.id);
    if (f.password && f.password.length < MIN_PASSWORD) throw new UserError("settings.passwordShort");

    const taken = await db.user.findUnique({ where: { phone: f.phone } });
    if (taken && taken.id !== f.id) throw new UserError("error.phoneTaken");

    await db.$transaction(async (tx) => {
      const u = f.id ? await tx.user.findFirst({ where: { id: f.id, centerId: ctx.centerId }, include: { branches: true } }) : null;
      if (f.id && !u) throw new UserError("error.notFound");
      const data = {
        name: f.name,
        phone: f.phone,
        role: f.role,
        isTeacher: f.role === "TEACHER" ? true : f.isTeacher,
        // public text for the AI agent; only teachers have one
        bio: (f.role === "TEACHER" || f.isTeacher) && f.bio ? f.bio.slice(0, BIO_MAX) : null,
        // a manager/admin can only hand out switches they hold — the role defaults included (S2)
        perms: staffPermsFor(ctx, f.role, picked, u?.perms),
      };
      let userId: string;
      if (u) {
        if (!canManageRole(ctx, u.role as RoleName)) throw new UserError("settings.cannotEditOwner");
        // a branch manager edits only staff who work entirely inside their branches
        if (!staffInScope(ctx, u.branches.map((b) => b.branchId))) throw new UserError("error.forbidden");
        if (u.id === ctx.userId && f.role !== u.role) throw new UserError("settings.cannotEditOwner");
        await tx.user.update({ where: { id: u.id }, data });
        // new phone: the chat linked to the old one loses the teacher menu and /parol codes (S3)
        await unlinkIfPhoneChanged(tx, "STAFF", u.id, u.phone, f.phone);
        // a password typed by an admin is a reset: old sessions end, the user picks their own next time
        if (f.password) await setPassword(tx, { id: u.id, phone: f.phone }, f.password, { mustChange: u.id !== ctx.userId });
        await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "User", entityId: u.id, action: "update", before: { ...u, passwordHash: undefined }, after: { ...data, branchIds, passwordChanged: !!f.password } });
        userId = u.id;
      } else {
        if (!f.password) throw new UserError("settings.passwordShort");
        const created = await tx.user.create({ data: { ...data, centerId: ctx.centerId, passwordHash: await bcrypt.hash(f.password, BCRYPT_ROUNDS), mustChangePassword: true } });
        await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "User", entityId: created.id, action: "create", after: { ...data, branchIds } });
        userId = created.id;
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
      // archived staff lose the bot (after a restore they re-link by sharing their contact)
      if (!u.archivedAt) await unlinkRef(tx, "STAFF", id);
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
