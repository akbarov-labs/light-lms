// CSV export for every list (HANDOFF §5 "Export"). Same filters and scoping as the pages.
import type { NextRequest } from "next/server";
import { branchWhere, getCtx, type Ctx } from "@/lib/ctx";
import { db } from "@/lib/db";
import { formatDate, formatDateTime, toISODate, todayISO } from "@/lib/dates";
import { slotSummary } from "@/lib/format";
import { csvResponse, toCsv, type Cell } from "@/lib/csv";
import { inOrder, studentIds } from "@/lib/queries/students";
import { balancesFor } from "@/lib/services/wallet";
import { listPayments } from "@/lib/queries/payments";
import { listAllDebtors } from "@/lib/queries/debtors";
import { groupStatusWhere, strParam } from "@/lib/queries/params";
import { listExpenses } from "@/lib/queries/expenses";
import { liveSalary } from "@/lib/salary/service";
import { auditWhere } from "@/lib/queries/audit";
import { attendanceStats, billedByGroup } from "@/lib/queries/reports";
import { isISODate, monthParam, monthRange } from "@/lib/dates";

export const dynamic = "force-dynamic";

type Exporter = (ctx: Ctx, sp: Record<string, string | undefined>) => Promise<{ header: string[]; rows: Cell[][] } | null>;

const exporters: Record<string, Exporter> = {
  async students(ctx, sp) {
    const status = sp.status === "ARCHIVED" ? "ARCHIVED" : sp.status === "all" ? undefined : "ACTIVE";
    // same filters as the students page (incl. "with debt"), resolved in SQL; rows loaded in batches
    const { ids } = await studentIds(ctx, { q: strParam(sp.q), status, groupId: strParam(sp.groupId), debt: sp.debt === "1" });
    const students = [];
    for (let i = 0; i < ids.length; i += 1000) {
      const chunk = ids.slice(i, i + 1000);
      const rows = await db.student.findMany({
        where: { id: { in: chunk } },
        include: { enrollments: { where: { endDate: null }, include: { group: { select: { name: true, code: true } } } }, family: { include: { guardians: true } }, branch: true },
      });
      students.push(...inOrder(chunk, rows));
    }
    const bal = ctx.can("finance.view") || ctx.can("payments.take") ? await balancesFor([...new Set(students.map((s) => s.familyId))]) : null;
    const { t } = ctx;
    return {
      header: [t("students.lastName"), t("students.firstName"), t("common.phone"), t("students.guardian"), t("students.guardianPhone"), t("students.birthDate"), t("common.branch"), t("students.groups"), t("common.status"), t("common.source"), t("common.tags"), ...(bal ? [t("students.familyBalance")] : [])],
      rows: students.map((s) => {
        const g = s.family.guardians.find((x) => x.isPrimary) ?? s.family.guardians[0];
        return [s.lastName, s.firstName, s.phone, g?.name, g?.phone, s.birthDate ? formatDate(s.birthDate) : "", s.branch?.name, s.enrollments.map((e) => `${e.group.name} #${e.group.code} (${t(`enrollment.${e.status}`)})`).join("; "), t(`student.${s.status}`), s.source, s.tags.join(", "), ...(bal ? [bal.get(s.familyId) ?? 0] : [])];
      }),
    };
  },
  async groups(ctx, sp) {
    const groups = await db.group.findMany({
      where: { centerId: ctx.centerId, ...branchWhere(ctx), ...(groupStatusWhere(sp.status)), ...(sp.teacherId ? { teacherId: sp.teacherId } : {}), ...(sp.courseId ? { courseId: sp.courseId } : {}) },
      include: { course: true, teacher: true, room: true, branch: true, slots: true, _count: { select: { enrollments: { where: { endDate: null, status: { in: ["TRIAL", "ACTIVE", "FROZEN"] } } } } } },
      orderBy: { code: "asc" },
    });
    const { t } = ctx;
    return {
      header: [t("common.code"), t("common.group"), t("common.course"), t("common.teacher"), t("common.branch"), t("common.room"), t("groups.schedule"), t("common.start"), t("common.end"), t("groups.studentsCount"), t("common.capacity"), t("common.price"), t("common.status")],
      rows: groups.map((g) => [g.code, g.name, g.course.name, g.teacher.name, g.branch.name, g.room?.name, slotSummary(g.slots, t), formatDate(toISODate(g.startDate)), g.endDate ? formatDate(toISODate(g.endDate)) : "", g._count.enrollments, g.capacity, g.priceOverride ?? g.course.price, t(`group.${g.status}`)]),
    };
  },
  async courses(ctx) {
    const courses = await db.course.findMany({ where: { centerId: ctx.centerId }, orderBy: { name: "asc" } });
    const { t } = ctx;
    return {
      header: [t("common.name"), t("courses.level"), t("courses.pricingType"), t("common.price"), t("courses.renewal"), t("courses.packageLessons"), t("courses.installments"), t("courses.lessonMinutes"), t("common.status")],
      rows: courses.map((c) => [c.name, c.level, t(`pricing.${c.pricingType}`), c.price, c.pricingType === "SUBSCRIPTION" ? t(`renewal.${c.renewal}`) : "", c.packageLessons, c.installments, c.lessonMinutes, c.archivedAt ? t("group.ARCHIVED") : t("group.ACTIVE")]),
    };
  },
  async payments(ctx, sp) {
    if (!ctx.can("payments.take") && !ctx.can("finance.view")) return null;
    const { rows, users } = await listPayments(ctx, sp);
    const { t } = ctx;
    return {
      header: [t("common.date"), t("pay.receiptNo"), t("payments.family"), t("common.student"), t("ledger.PAYMENT"), t("common.method"), t("common.amount"), t("common.description"), t("pay.cashier"), t("pay.reversed")],
      rows: rows.map((r) => [formatDate(toISODate(r.date)), r.receiptNo, r.family.name, r.student ? `${r.student.lastName} ${r.student.firstName}` : "", t(`ledger.${r.type}`), r.method ? t(`method.${r.method}`) : "", r.amount, r.description, r.createdById ? users.get(r.createdById) : "Payme", r.reversedBy ? t("common.yes") : ""]),
    };
  },
  async debtors(ctx, sp) {
    if (!ctx.can("payments.take") && !ctx.can("finance.view")) return null;
    const rows = await listAllDebtors(ctx, { groupId: strParam(sp.groupId), teacherId: strParam(sp.teacherId), min: strParam(sp.min) });
    const { t } = ctx;
    return {
      header: [t("common.students"), t("common.groups"), t("common.debt"), t("debtors.daysOverdue"), t("debtors.lastPayment"), t("common.phone"), "Telegram"],
      rows: rows.map((r) => [r.students.map((s) => s.name).join("; "), r.groups.map((g) => g.name).join("; "), r.debt, r.daysOverdue, r.lastPayment ? formatDate(r.lastPayment) : "", r.phone, r.telegram ? t("common.yes") : t("common.no")]),
    };
  },
  async expenses(ctx, sp) {
    if (!ctx.can("finance.view")) return null;
    const { rows, users } = await listExpenses(ctx, sp);
    const { t } = ctx;
    return {
      header: [t("common.date"), t("expenses.category"), t("common.branch"), t("common.amount"), t("common.note"), t("common.createdBy"), t("expenses.reversed")],
      rows: rows.map((r) => [formatDate(toISODate(r.date)), r.category, r.branch?.name ?? t("expenses.centerWide"), r.amount, r.note, users.get(r.createdById), r.reversedAt ? t("common.yes") : ""]),
    };
  },
  async leads(ctx, sp) {
    if (!ctx.can("leads")) return null;
    const ids = ctx.activeBranchId ? [ctx.activeBranchId] : ctx.branchIds;
    const leads = await db.lead.findMany({
      where: { centerId: ctx.centerId, archivedAt: sp.archived ? { not: null } : null, ...(ids ? { OR: [{ branchId: { in: ids } }, { branchId: null }] } : {}), ...(sp.source ? { source: sp.source } : {}), ...(sp.assigned ? { assignedToId: sp.assigned } : {}) },
      include: { course: true, assignedTo: true, branch: true },
      orderBy: { createdAt: "desc" },
    });
    const { t } = ctx;
    return {
      header: [t("common.createdAt"), t("common.fullName"), t("common.phone"), t("leads.stage"), t("common.source"), t("leads.interestedCourse"), t("common.branch"), t("leads.assigned"), t("leads.nextContact"), t("leads.lostReason"), t("common.tags")],
      rows: leads.map((l) => [formatDateTime(l.createdAt), l.name, l.phone, t(`lead.${l.stage}`), l.source, l.course?.name, l.branch?.name, l.assignedTo?.name, l.nextContactAt ? formatDate(l.nextContactAt) : "", l.lostReason, l.tags.join(", ")]),
    };
  },
  async salary(ctx, sp) {
    if (!ctx.can("finance.view")) return null;
    const month = monthParam(sp.month);
    const teachers = await db.user.findMany({
      where: { centerId: ctx.centerId, OR: [{ isTeacher: true }, { role: "TEACHER" }], ...(ctx.branchIds ? { branches: { some: { branchId: { in: ctx.branchIds } } } } : {}) },
      orderBy: { name: "asc" },
    });
    const { t } = ctx;
    const rows: Cell[][] = [];
    for (const u of teachers) {
      const [{ result }, slip] = await Promise.all([liveSalary(ctx.centerId, u.id, month), db.payslip.findUnique({ where: { teacherId_month: { teacherId: u.id, month } } })]);
      rows.push([month, u.name, result.model ? t(`salary.${result.model}`) : "", result.lessonsHeld, result.base, result.adjustmentsTotal, result.total, t(`payslip.${slip?.status ?? "DRAFT"}`), slip && slip.status !== "DRAFT" ? slip.total : ""]);
    }
    return { header: [t("common.month"), t("common.teacher"), t("salary.model"), t("salary.lessonsHeld"), t("salary.base"), t("salary.adjustments"), t("salary.live"), t("common.status"), t("salary.lockedTotal")], rows };
  },
  async audit(ctx, sp) {
    if ((!ctx.can("finance.view") && !ctx.can("settings")) || ctx.branchIds) return null;
    const logs = await db.auditLog.findMany({ where: auditWhere(ctx, sp), orderBy: { createdAt: "desc" }, take: 20_000 });
    const users = new Map((await db.user.findMany({ where: { centerId: ctx.centerId }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
    return {
      header: ["time", "user", "entity", "entityId", "action", "before", "after"],
      rows: logs.map((l) => [formatDateTime(l.createdAt), l.userId ? users.get(l.userId) : "system", l.entity, l.entityId, l.action, l.before ? JSON.stringify(l.before) : "", l.after ? JSON.stringify(l.after) : ""]),
    };
  },
  /** Reports page tables in full: billed and attendance per group for the chosen period. */
  async "report-groups"(ctx, sp) {
    if (!ctx.can("finance.view")) return null;
    const m = monthRange(todayISO().slice(0, 7));
    const p = { from: isISODate(sp.from) ? sp.from : m.start, to: isISODate(sp.to) ? sp.to : m.end };
    const [billed, att] = await Promise.all([billedByGroup(ctx, p), attendanceStats(ctx, p)]);
    const rate = new Map(att.byGroup.map((g) => [g.name, g.rate]));
    const names = [...new Set([...billed.map((g) => g.name), ...att.byGroup.map((g) => g.name)])];
    const b = new Map(billed.map((g) => [g.name, g]));
    const { t } = ctx;
    return {
      header: [t("common.group"), t("common.course"), t("common.teacher"), t("reports.billed"), `${t("reports.attendance")} %`],
      rows: names.map((n) => [n, b.get(n)?.course ?? "", b.get(n)?.teacher ?? "", b.get(n)?.billed ?? 0, rate.get(n) ?? ""]),
    };
  },
  async staff(ctx) {
    if (!ctx.can("staff.manage")) return null;
    const users = await db.user.findMany({
      where: { centerId: ctx.centerId, ...(ctx.branchIds ? { branches: { some: { branchId: { in: ctx.branchIds } } } } : {}) },
      include: { branches: { include: { branch: true } } },
      orderBy: { name: "asc" },
    });
    const { t } = ctx;
    return {
      header: [t("common.fullName"), t("common.phone"), t("settings.role"), t("settings.isTeacher"), t("settings.staffBranches"), t("settings.perms"), t("common.status")],
      rows: users.map((u) => [u.name, u.phone, t(`role.${u.role}`), u.isTeacher ? t("common.yes") : "", u.branches.map((b) => b.branch.name).join("; "), u.perms.join(" "), u.archivedAt ? t("settings.archived") : ""]),
    };
  },
};

export async function GET(req: NextRequest, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  const ctx = await getCtx();
  if (!ctx) return new Response("unauthorized", { status: 401 });
  if (!ctx.can("export")) return new Response("forbidden", { status: 403 });
  const exporter = exporters[kind];
  if (!exporter) return new Response("not found", { status: 404 });
  const sp = Object.fromEntries(req.nextUrl.searchParams.entries());
  const data = await exporter(ctx, sp);
  if (!data) return new Response("forbidden", { status: 403 });
  return csvResponse(`${kind}-${todayISO()}.csv`, toCsv(data.header, data.rows));
}
