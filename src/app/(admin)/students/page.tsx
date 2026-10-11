import Link from "next/link";
import type { Prisma } from "@prisma/client";
import { requireStaff, studentScope } from "@/lib/ctx";
import { db } from "@/lib/db";
import { formatMoney } from "@/lib/money";
import { formatPhone } from "@/lib/phone";
import { enrollmentTone, fullName } from "@/lib/format";
import { studentSearch } from "@/lib/search";
import { balancesFor } from "@/lib/services/wallet";
import { Badge, Card, EmptyState, LinkButton, PageHeader, Pagination, Table, Td, Th, Tr, cx } from "@/components/ui";
import { Input, Select } from "@/components/fields";

const PAGE = 30;

export default async function StudentsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireStaff();
  const { t } = ctx;
  const page = Math.max(1, Number(sp.page) || 1);
  const status = sp.status === "ARCHIVED" ? "ARCHIVED" : sp.status === "all" ? undefined : "ACTIVE";

  let debtFamilies: string[] | null = null;
  if (sp.debt === "1") {
    const rows = await db.ledgerEntry.groupBy({ by: ["familyId"], where: { centerId: ctx.centerId }, _sum: { amount: true }, having: { amount: { _sum: { lt: 0 } } } });
    debtFamilies = rows.map((r) => r.familyId);
  }
  const where: Prisma.StudentWhereInput = {
    AND: [
      { centerId: ctx.centerId },
      studentScope(ctx),
      studentSearch(sp.q),
      status ? { status } : {},
      sp.groupId ? { enrollments: { some: { groupId: sp.groupId, endDate: null } } } : {},
      debtFamilies ? { familyId: { in: debtFamilies } } : {},
    ],
  };
  const [students, total, groups] = await Promise.all([
    db.student.findMany({
      where,
      include: {
        enrollments: { where: { endDate: null }, include: { group: { select: { id: true, name: true, code: true } } } },
        family: { select: { guardians: { where: { isPrimary: true }, select: { phone: true }, take: 1 } } },
      },
      orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
      skip: (page - 1) * PAGE,
      take: PAGE,
    }),
    db.student.count({ where }),
    db.group.findMany({ where: { centerId: ctx.centerId, status: { in: ["ACTIVE", "PLANNED"] }, ...(ctx.branchIds ? { branchId: { in: ctx.branchIds } } : {}) }, select: { id: true, name: true, code: true }, orderBy: { name: "asc" } }),
  ]);
  const balances = ctx.can("finance.view") || ctx.can("payments.take") ? await balancesFor([...new Set(students.map((s) => s.familyId))]) : null;
  const exportQs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "page") as [string, string][]).toString();
  return (
    <>
      <PageHeader
        title={t("nav.students")}
        subtitle={`${total}`}
        actions={
          <>
            {ctx.can("export") && <LinkButton variant="secondary" href={`/api/export/students?${exportQs}`}>{t("common.export")}</LinkButton>}
            {ctx.can("students.edit") && <LinkButton variant="secondary" href="/students/import">{t("import.button")}</LinkButton>}
            {ctx.can("students.edit") && <LinkButton href="/students/new">+ {t("students.new")}</LinkButton>}
          </>
        }
      />
      <form className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-5">
        <Input name="q" defaultValue={sp.q} placeholder={`${t("common.search")}: ${t("common.fullName")}, ${t("common.phone").toLowerCase()}`} className="col-span-2" />
        <Select name="groupId" defaultValue={sp.groupId ?? ""}>
          <option value="">{t("students.filterGroup")}: {t("common.all")}</option>
          {groups.map((g) => <option key={g.id} value={g.id}>{g.name} #{g.code}</option>)}
        </Select>
        <Select name="status" defaultValue={sp.status ?? "ACTIVE"}>
          <option value="ACTIVE">{t("student.ACTIVE")}</option>
          <option value="ARCHIVED">{t("student.ARCHIVED")}</option>
          <option value="all">{t("common.all")}</option>
        </Select>
        <div className="col-span-2 flex items-center gap-3 sm:col-span-1">
          <label className="flex items-center gap-1.5 text-sm"><input type="checkbox" name="debt" value="1" defaultChecked={sp.debt === "1"} className="h-4 w-4" /> {t("students.withDebt")}</label>
          <button className="ml-auto rounded-lg bg-slate-800 px-3 py-2 text-sm font-medium text-white">{t("common.filter")}</button>
        </div>
      </form>
      <Card pad={false}>
        {students.length === 0 ? (
          <EmptyState>{t("common.empty")}</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr><Th>{t("common.fullName")}</Th><Th>{t("common.phone")}</Th><Th>{t("students.groups")}</Th>{balances && <Th className="text-right">{t("students.familyBalance")}</Th>}</tr>
            </thead>
            <tbody>
              {students.map((s) => {
                const bal = balances?.get(s.familyId) ?? 0;
                return (
                  <Tr key={s.id}>
                    <Td>
                      <Link href={`/students/${s.id}`} className="font-medium text-slate-900 hover:text-accent">{fullName(s)}</Link>
                      {s.status === "ARCHIVED" && <> <Badge>{t("student.ARCHIVED")}</Badge></>}
                      {s.tags.length > 0 && <div className="mt-0.5 flex flex-wrap gap-1">{s.tags.map((tg) => <span key={tg} className="text-xs text-slate-400">#{tg}</span>)}</div>}
                    </Td>
                    <Td className="whitespace-nowrap text-xs">{formatPhone(s.phone ?? s.family.guardians[0]?.phone)}</Td>
                    <Td>
                      <div className="flex flex-wrap gap-1">
                        {s.enrollments.length === 0 && <span className="text-xs text-slate-400">{t("students.noGroup")}</span>}
                        {s.enrollments.map((e) => (
                          <Link key={e.id} href={`/groups/${e.group.id}`}><Badge tone={enrollmentTone[e.status]}>{e.group.name}</Badge></Link>
                        ))}
                      </div>
                    </Td>
                    {balances && <Td className={cx("whitespace-nowrap text-right font-medium", bal < 0 ? "text-rose-600" : bal > 0 ? "text-emerald-600" : "text-slate-400")}>{formatMoney(bal)}</Td>}
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pages={Math.ceil(total / PAGE)} params={sp} path="/students" t={t} />
      </Card>
    </>
  );
}
