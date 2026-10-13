import Link from "next/link";
import { redirect } from "next/navigation";
import { requireStaff } from "@/lib/ctx";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { auditWhere } from "@/lib/queries/audit";
import { Card, EmptyState, LinkButton, PageHeader, Pagination, Table, Td, Th, Tr } from "@/components/ui";
import { Input, Select } from "@/components/fields";

const PAGE = 50;
const ENTITIES = ["LedgerEntry", "Enrollment", "Student", "Lesson", "Group", "Course", "Payslip", "SalaryRule", "SalaryAdjustment", "Expense", "Lead", "User", "Branch", "Holiday", "Center", "Guardian", "PaymeTransaction"];

function link(entity: string, id: string): string | null {
  switch (entity) {
    case "Student": return `/students/${id}`;
    case "Group": return `/groups/${id}`;
    case "Lesson": return `/lessons/${id}`;
    case "Lead": return `/leads/${id}`;
    case "LedgerEntry": return `/r/${id}`;
    default: return null;
  }
}

function short(v: unknown): string {
  if (v === null || v === undefined) return "";
  const s = JSON.stringify(v);
  return s.length > 160 ? `${s.slice(0, 160)}…` : s;
}

export default async function AuditPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const ctx = await requireStaff();
  // the global journal spans every branch, so branch-scoped users see history on each record instead
  if ((!ctx.can("finance.view") && !ctx.can("settings")) || ctx.branchIds) redirect("/forbidden");
  const { t } = ctx;
  const page = Math.max(1, Number(sp.page) || 1);
  const where = auditWhere(ctx, sp);
  const [logs, total, users] = await Promise.all([
    db.auditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE }),
    db.auditLog.count({ where }),
    db.user.findMany({ where: { centerId: ctx.centerId }, select: { id: true, name: true }, orderBy: { name: "asc" } }),
  ]);
  const names = new Map(users.map((u) => [u.id, u.name]));
  const qs = new URLSearchParams(Object.entries(sp).filter(([k, v]) => v && k !== "page") as [string, string][]).toString();
  return (
    <>
      <PageHeader title={t("nav.audit")} subtitle={total} actions={ctx.can("export") && <LinkButton variant="secondary" href={`/api/export/audit?${qs}`}>{t("common.export")}</LinkButton>} />
      <form className="mb-4 flex flex-wrap items-center gap-2 *:w-full *:min-w-0 sm:*:w-auto">
        <Select name="entity" aria-label={t("audit.entity")} defaultValue={sp.entity ?? ""}>
          <option value="">{t("audit.entity")}: {t("common.all")}</option>
          {ENTITIES.map((e) => <option key={e} value={e}>{e}</option>)}
        </Select>
        <Select name="userId" aria-label={t("audit.user")} defaultValue={sp.userId ?? ""}>
          <option value="">{t("audit.user")}: {t("common.all")}</option>
          <option value="system">{t("audit.system")}</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
        </Select>
        <Input name="action" defaultValue={sp.action} placeholder={t("audit.action")} aria-label={t("audit.action")} />
        <Input type="date" aria-label={t("common.from")} name="from" defaultValue={sp.from} />
        <Input type="date" aria-label={t("common.to")} name="to" defaultValue={sp.to} />
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-xs"><input type="checkbox" name="sync" value="1" defaultChecked={!!sp.sync} /> sync</label>
          <button className="ml-auto h-9 rounded-lg bg-zinc-900 px-3.5 text-sm font-medium text-white hover:bg-zinc-800">{t("common.filter")}</button>
        </div>
      </form>
      <Card pad={false}>
        {logs.length === 0 ? <EmptyState>{t("common.empty")}</EmptyState> : (
          <Table>
            <thead><tr><Th>{t("common.time")}</Th><Th>{t("audit.user")}</Th><Th>{t("audit.entity")}</Th><Th>{t("audit.action")}</Th><Th>{t("audit.change")}</Th></tr></thead>
            <tbody>
              {logs.map((l) => {
                const href = link(l.entity, l.entityId);
                return (
                  <Tr key={l.id}>
                    <Td className="whitespace-nowrap text-xs">{formatDateTime(l.createdAt)}</Td>
                    <Td className="text-xs">{l.userId ? names.get(l.userId) : t("audit.system")}</Td>
                    <Td className="text-xs">{href ? <Link href={href} className="text-zinc-900 underline decoration-zinc-300 hover:decoration-zinc-900">{l.entity}</Link> : l.entity}</Td>
                    <Td className="text-xs font-medium">{l.action}</Td>
                    <Td className="max-w-xl break-all font-mono text-[11px] text-zinc-500">
                      {l.before !== null && <div>− {short(l.before)}</div>}
                      {l.after !== null && <div>+ {short(l.after)}</div>}
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pages={Math.ceil(total / PAGE)} params={sp} path="/audit" t={t} />
      </Card>
    </>
  );
}
