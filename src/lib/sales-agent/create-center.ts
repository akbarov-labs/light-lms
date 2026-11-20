// Creates a center from a checked onboarding plan (onboarding.ts → planFromDraft): the same records and rules
// as the setup wizard (src/app/(admin)/setup/actions.ts) — groups with their weekly slots and generated
// lessons, the group clash check, teachers with a temporary password and a salary rule, an audit entry for
// each — in one transaction, so a failure leaves nothing half made. Students come after, through the usual
// CSV import (scripts/create-from-onboarding.ts --students).
import bcrypt from "bcryptjs";
import type { Plan, Prisma } from "@/generated/prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { PERMS } from "@/lib/perms";
import { makeT } from "@/lib/i18n";
import { fromISODate, monthRange, todayISO, type ISODate } from "@/lib/dates";
import { newTempPassword } from "@/lib/auth/security";
import { BCRYPT_ROUNDS } from "@/lib/auth/password";
import { slugify, uniqueSlug } from "@/lib/signup-rules";
import { assertNoGroupClash, generateLessons } from "@/lib/services/lessons";
import { createSalaryRule } from "@/lib/salary/service";
import type { CenterPlan } from "./onboarding";

export interface CreatedCenter {
  centerId: string;
  slug: string;
  owner: { name: string; phone: string; password: string };
  teachers: { name: string; phone: string; password: string }[];
  groups: { name: string; code: number }[];
}

export async function createCenterFromPlan(plan: CenterPlan, opts: { slug?: string; plan?: Plan; source: string; today?: ISODate }): Promise<CreatedCenter> {
  const today = opts.today ?? todayISO();
  const phones = [plan.owner.phone, ...plan.teachers.map((t) => t.phone)];
  const taken = await db.user.findMany({ where: { phone: { in: phones } }, select: { phone: true } });
  if (taken.length) throw new Error(`phone(s) already have an account: ${taken.map((u) => u.phone).join(", ")}`);
  const base = opts.slug ?? slugify(plan.center.name);
  const used = await db.center.findMany({ where: { slug: { startsWith: base } }, select: { slug: true } });
  const slug = opts.slug ? base : uniqueSlug(base, used.map((c) => c.slug));
  if (opts.slug && used.some((c) => c.slug === base)) throw new Error(`center slug "${base}" is taken`);

  const ownerPassword = newTempPassword();
  const teacherPasswords = plan.teachers.map(() => newTempPassword());
  const hash = (p: string) => bcrypt.hash(p, BCRYPT_ROUNDS);
  const [ownerHash, ...teacherHashes] = await Promise.all([hash(ownerPassword), ...teacherPasswords.map(hash)]);
  const t = makeT("uz");

  return db.$transaction(
    async (tx) => {
      const center = await tx.center.create({
        data: { name: plan.center.name, slug, phone: plan.center.phone, plan: opts.plan ?? "FREE", settings: plan.settings as Prisma.InputJsonValue },
      });
      const branches = await Promise.all(
        plan.branches.map((b) =>
          tx.branch.create({
            data: { centerId: center.id, name: b.name, address: b.address, rooms: { create: b.rooms.map((name) => ({ name })) } },
            include: { rooms: true },
          }),
        ),
      );
      const owner = await tx.user.create({
        data: {
          centerId: center.id,
          name: plan.owner.name,
          phone: plan.owner.phone,
          role: "OWNER",
          isTeacher: plan.owner.teaches,
          perms: [...PERMS],
          passwordHash: ownerHash,
          mustChangePassword: true,
          branches: { create: branches.map((b) => ({ branchId: b.id })) },
        },
      });
      const actor = { centerId: center.id, userId: owner.id };
      await audit(tx, { ...actor, entity: "Center", entityId: center.id, action: "create", after: { by: opts.source, owner: owner.id, plan: center.plan } });

      const courses = [];
      for (const c of plan.courses) {
        const row = await tx.course.create({
          data: { centerId: center.id, name: c.name, pricingType: c.pricingType, price: c.price, lessonsPerWeek: c.lessonsPerWeek, lessonMinutes: c.lessonMinutes, packageLessons: c.packageLessons },
        });
        await audit(tx, { ...actor, entity: "Course", entityId: row.id, action: "create", after: row });
        courses.push(row);
      }

      // a teacher sees the branches they teach in (the first branch when they have no group yet)
      const teacherBranches = plan.teachers.map((_, i) => [...new Set(plan.groups.filter((g) => g.teacher === i).map((g) => branches[g.branch].id))]);
      const teachers = [];
      for (const [i, tp] of plan.teachers.entries()) {
        const ids = teacherBranches[i].length ? teacherBranches[i] : [branches[0].id];
        const u = await tx.user.create({
          data: { centerId: center.id, name: tp.name, phone: tp.phone, role: "TEACHER", isTeacher: true, perms: [], passwordHash: teacherHashes[i], mustChangePassword: true, branches: { create: ids.map((branchId) => ({ branchId })) } },
        });
        await audit(tx, { ...actor, entity: "User", entityId: u.id, action: "create", after: { name: u.name, phone: u.phone, role: u.role, via: opts.source } });
        // from the 1st of this month, so this month's lessons already count (same as the setup wizard)
        if (tp.salary) await createSalaryRule(tx, actor, u.id, { ...tp.salary, validFrom: monthRange(today.slice(0, 7)).start });
        teachers.push(u);
      }

      const groups = [];
      for (const g of plan.groups) {
        const branch = branches[g.branch];
        const teacherId = g.teacher === "owner" ? owner.id : teachers[g.teacher].id;
        const room = g.room ? (branch.rooms.find((r) => r.name.trim().toLowerCase() === g.room!.trim().toLowerCase()) ?? null) : null;
        const startDate = g.startDate ?? today;
        await assertNoGroupClash(tx, t, { centerId: center.id, teacherId, roomId: room?.id ?? null, from: startDate, to: null, slots: g.slots });
        const { groupSeq } = await tx.center.update({ where: { id: center.id }, data: { groupSeq: { increment: 1 } }, select: { groupSeq: true } });
        const row = await tx.group.create({
          data: {
            centerId: center.id,
            branchId: branch.id,
            courseId: courses[g.course].id,
            teacherId,
            roomId: room?.id ?? null,
            code: groupSeq,
            name: g.name,
            startDate: fromISODate(startDate),
            status: startDate > today ? "PLANNED" : "ACTIVE",
            slots: { create: g.slots },
          },
        });
        await audit(tx, { ...actor, entity: "Group", entityId: row.id, action: "create", after: { ...row, slots: g.slots } });
        await generateLessons(row.id, { tx, today });
        groups.push({ name: row.name, code: row.code });
      }

      return {
        centerId: center.id,
        slug,
        owner: { name: owner.name, phone: owner.phone, password: ownerPassword },
        teachers: teachers.map((u, i) => ({ name: u.name, phone: u.phone, password: teacherPasswords[i] })),
        groups,
      };
    },
    { timeout: 120_000 },
  );
}
