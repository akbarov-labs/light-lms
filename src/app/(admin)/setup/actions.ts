"use server";

// First-run setup wizard (owner): branch & rooms → first course → first group → invite a teacher.
// Each step saves real records (same rules as the regular pages) and records progress in Center.onboarding.
import bcrypt from "bcryptjs";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { Prisma } from "@/generated/prisma/client";
import { runAction, type ActionState } from "@/lib/action";
import { actionCtx } from "@/lib/ctx";
import { db, type Tx } from "@/lib/db";
import { audit } from "@/lib/audit";
import { formList, formObject, zDate, zMoney, zOptInt, zOptMoney, zOptStr, zPhone, zStr, zTime } from "@/lib/forms";
import { UserError } from "@/lib/user-error";
import { assertNotDemo } from "@/lib/demo-guard";
import { fromISODate, monthRange, todayISO } from "@/lib/dates";
import { validSlot, type WeeklySlot } from "@/lib/schedule";
import { assertNoGroupClash, generateLessons } from "@/lib/services/lessons";
import { BCRYPT_ROUNDS } from "@/lib/auth/password";
import { MIN_PASSWORD } from "@/lib/auth/security";
import { normalizeRule } from "@/lib/salary/models";
import { createSalaryRule } from "@/lib/salary/service";
import { dismiss, isSetupStep, markStep, readOnboarding, type Onboarding } from "@/lib/onboarding";

async function updateProgress(tx: Tx, centerId: string, fn: (o: Onboarding) => Onboarding): Promise<void> {
  const c = await tx.center.findUniqueOrThrow({ where: { id: centerId }, select: { onboarding: true } });
  await tx.center.update({ where: { id: centerId }, data: { onboarding: fn(readOnboarding(c.onboarding)) as unknown as Prisma.InputJsonValue } });
}

/** Run a step; on success go back to /setup, which opens the next unfinished step. */
async function step(fn: Parameters<typeof runAction>[1]): Promise<ActionState> {
  const res = await runAction("settings", fn);
  if (res?.ok) {
    revalidatePath("/", "layout");
    redirect("/setup");
  }
  return res;
}

// ---------------------------------------------------------------- 1. branch & rooms

export async function setupBranchAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return step(async (ctx) => {
    const f = z.object({ branchId: z.string().min(1), name: zStr, address: zOptStr }).parse(formObject(fd));
    const ids = fd.getAll("rooms.id").map(String);
    const names = fd.getAll("rooms.name").map((v) => String(v).trim().slice(0, 60));
    await db.$transaction(async (tx) => {
      const b = await tx.branch.findFirst({ where: { id: f.branchId, centerId: ctx.centerId } });
      if (!b) throw new UserError("error.notFound");
      const after = await tx.branch.update({ where: { id: b.id }, data: { name: f.name, address: f.address ?? null } });
      await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Branch", entityId: b.id, action: "update", before: b, after });
      // existing rooms are renamed (never removed here — they may already be in a schedule); new names are added
      for (const [i, name] of names.entries()) {
        if (!name) continue;
        const id = ids[i];
        if (id) await tx.room.updateMany({ where: { id, branchId: b.id }, data: { name } });
        else await tx.room.create({ data: { branchId: b.id, name } });
      }
      await updateProgress(tx, ctx.centerId, (o) => markStep(o, "branch", "done", new Date()));
    });
  });
}

// ---------------------------------------------------------------- 2. course

const courseSchema = z.object({
  name: zStr,
  lessonMinutes: zOptInt(15, 600),
  lessonsPerWeek: zOptInt(1, 21),
  pricingType: z.enum(["SUBSCRIPTION", "PACKAGE"]),
  price: zMoney,
  renewal: z.enum(["CALENDAR", "GROUP_START", "STUDENT_START"]).default("CALENDAR"),
  renewalDay: zOptInt(1, 28),
  packageLessons: zOptInt(1, 1000),
  installments: zOptInt(1, 24),
});

export async function setupCourseAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return step(async (ctx) => {
    if (!ctx.can("groups.edit")) throw new UserError("error.forbidden");
    const f = courseSchema.parse(formObject(fd));
    await db.$transaction(async (tx) => {
      const c = await tx.course.create({
        data: {
          centerId: ctx.centerId,
          name: f.name,
          lessonMinutes: f.lessonMinutes ?? 90,
          lessonsPerWeek: f.lessonsPerWeek ?? null,
          pricingType: f.pricingType,
          price: f.price,
          renewal: f.renewal,
          renewalDay: f.pricingType === "SUBSCRIPTION" && f.renewal === "CALENDAR" ? (f.renewalDay ?? 1) : 1,
          packageLessons: f.pricingType === "PACKAGE" ? (f.packageLessons ?? null) : null,
          installments: f.pricingType === "PACKAGE" ? (f.installments ?? 1) : 1,
        },
      });
      await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Course", entityId: c.id, action: "create", after: c });
      await updateProgress(tx, ctx.centerId, (o) => markStep(o, "course", "done", new Date(), { courseId: c.id }));
    });
  });
}

// ---------------------------------------------------------------- 3. group

const groupSchema = z.object({
  name: zStr,
  courseId: z.string().min(1),
  branchId: z.string().min(1),
  roomId: zOptStr,
  teacherId: z.string().min(1),
  startDate: zDate,
  startTime: zTime,
  endTime: zTime,
});

export async function setupGroupAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return step(async (ctx) => {
    if (!ctx.can("groups.edit")) throw new UserError("error.forbidden");
    const f = groupSchema.parse(formObject(fd));
    const days = [...new Set(formList(fd, "days").map(Number))].filter((d) => d >= 1 && d <= 7).sort();
    if (days.length === 0) throw new UserError("setup.pickDay");
    const slots: WeeklySlot[] = days.map((weekday) => ({ weekday, startTime: f.startTime, endTime: f.endTime }));
    if (!slots.every(validSlot)) throw new UserError("error.slotTime");
    const [course, branch, teacher, room] = await Promise.all([
      db.course.findFirst({ where: { id: f.courseId, centerId: ctx.centerId, archivedAt: null } }),
      db.branch.findFirst({ where: { id: f.branchId, centerId: ctx.centerId } }),
      db.user.findFirst({ where: { id: f.teacherId, centerId: ctx.centerId, archivedAt: null } }),
      f.roomId ? db.room.findFirst({ where: { id: f.roomId, branchId: f.branchId } }) : Promise.resolve(null),
    ]);
    if (!course || !branch || !teacher || (f.roomId && !room)) throw new UserError("error.notFound");
    // the owner may teach the first group themselves; anyone else must already be a teacher
    if (teacher.role !== "TEACHER" && !teacher.isTeacher && teacher.id !== ctx.userId) throw new UserError("error.notFound");
    await db.$transaction(
      async (tx) => {
        if (teacher.id === ctx.userId && !teacher.isTeacher) await tx.user.update({ where: { id: teacher.id }, data: { isTeacher: true } });
        await assertNoGroupClash(tx, ctx.t, { centerId: ctx.centerId, teacherId: teacher.id, roomId: room?.id ?? null, from: f.startDate, to: null, slots });
        const { groupSeq } = await tx.center.update({ where: { id: ctx.centerId }, data: { groupSeq: { increment: 1 } }, select: { groupSeq: true } });
        const g = await tx.group.create({
          data: {
            centerId: ctx.centerId,
            branchId: branch.id,
            courseId: course.id,
            teacherId: teacher.id,
            roomId: room?.id ?? null,
            code: groupSeq,
            name: f.name,
            startDate: fromISODate(f.startDate),
            status: f.startDate > todayISO() ? "PLANNED" : "ACTIVE",
            slots: { create: slots },
          },
        });
        await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Group", entityId: g.id, action: "create", after: { ...g, slots } });
        await generateLessons(g.id, { tx });
        await updateProgress(tx, ctx.centerId, (o) => markStep(o, "group", "done", new Date(), { groupId: g.id }));
      },
      { timeout: 30_000 },
    );
  });
}

// ---------------------------------------------------------------- 4. teacher

const teacherSchema = z.object({
  name: zStr,
  phone: zPhone,
  password: z.string().min(MIN_PASSWORD).max(200),
  assignGroupId: zOptStr,
  // how the teacher is paid, asked here so a new teacher never silently earns 0 (DECISIONS 2026-11-01)
  model: z.enum(["PERCENT_EARNED", "FIXED", "PER_LESSON", "BASE_PLUS_PERCENT"]).optional(),
  percent: zOptInt(0, 100),
  fixedAmount: zOptMoney,
  perLesson: zOptMoney,
});

export async function setupTeacherAction(_: ActionState, fd: FormData): Promise<ActionState> {
  return step(async (ctx) => {
    // public demo: visitors must not create staff logins (same rule as Settings → Staff)
    assertNotDemo();
    if (!ctx.can("staff.manage")) throw new UserError("error.forbidden");
    const parsed = teacherSchema.safeParse(formObject(fd));
    if (!parsed.success) {
      if (parsed.error.issues.some((i) => i.path[0] === "password")) throw new UserError("auth.passwordShort");
      throw parsed.error;
    }
    const f = parsed.data;
    if (await db.user.findUnique({ where: { phone: f.phone }, select: { id: true } })) throw new UserError("error.phoneTaken");
    const group = f.assignGroupId ? await db.group.findFirst({ where: { id: f.assignGroupId, centerId: ctx.centerId } }) : null;
    if (f.assignGroupId && !group) throw new UserError("error.notFound");
    const branch = group ? { id: group.branchId } : await db.branch.findFirst({ where: { centerId: ctx.centerId, archivedAt: null }, orderBy: { createdAt: "asc" }, select: { id: true } });
    const passwordHash = await bcrypt.hash(f.password, BCRYPT_ROUNDS);
    await db.$transaction(
      async (tx) => {
        const u = await tx.user.create({
          // a temporary password typed by the owner: the teacher must choose their own at first sign-in
          data: { centerId: ctx.centerId, name: f.name, phone: f.phone, role: "TEACHER", isTeacher: true, perms: [], passwordHash, mustChangePassword: true, ...(branch ? { branches: { create: [{ branchId: branch.id }] } } : {}) },
        });
        await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "User", entityId: u.id, action: "create", after: { name: u.name, phone: u.phone, role: u.role, via: "setup" } });
        if (group) {
          // hand the group over: future lessons follow the new teacher (same rule as editing a group)
          const today = fromISODate(todayISO());
          await tx.group.update({ where: { id: group.id }, data: { teacherId: u.id } });
          await tx.lesson.updateMany({ where: { groupId: group.id, date: { gte: today }, status: "SCHEDULED", teacherId: group.teacherId }, data: { teacherId: u.id } });
          await audit(tx, { centerId: ctx.centerId, userId: ctx.userId, entity: "Group", entityId: group.id, action: "update", before: { teacherId: group.teacherId }, after: { teacherId: u.id } });
        }
        // from the 1st of this month, so this month's lessons already count
        if (f.model && ctx.can("finance.view")) {
          await createSalaryRule(tx, { userId: ctx.userId, centerId: ctx.centerId }, u.id, { ...normalizeRule(f.model, f), validFrom: monthRange(todayISO().slice(0, 7)).start });
        }
        await updateProgress(tx, ctx.centerId, (o) => markStep(o, "teacher", "done", new Date(), { teacherId: u.id }));
      },
      { timeout: 30_000 },
    );
  });
}

// ---------------------------------------------------------------- skip / dismiss

export async function skipStepAction(fd: FormData): Promise<void> {
  const ctx = await actionCtx("settings");
  const s = String(fd.get("step") ?? "");
  if (!isSetupStep(s)) return;
  await db.$transaction((tx) => updateProgress(tx, ctx.centerId, (o) => markStep(o, s, "skipped", new Date())));
  revalidatePath("/", "layout");
  redirect("/setup");
}

/** "Later": hide the wizard banner; progress stays and /setup still works. */
export async function dismissSetupAction(): Promise<void> {
  const ctx = await actionCtx("settings");
  await db.$transaction((tx) => updateProgress(tx, ctx.centerId, (o) => dismiss(o, new Date())));
  revalidatePath("/", "layout");
  redirect("/");
}
