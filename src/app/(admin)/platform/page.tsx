import Link from "next/link";
import { notFound } from "next/navigation";
import type { Prisma } from "@/generated/prisma/client";
import { requireCtx } from "@/lib/ctx";
import { db } from "@/lib/db";
import { formatDate, formatDateTime } from "@/lib/dates";
import { formatPhone } from "@/lib/phone";
import { doneCount, readOnboarding, SETUP_STEPS } from "@/lib/onboarding";
import { isPlan, PLAN_NAMES, planUsage } from "@/lib/plans";
import { activeStudentsByCenter } from "@/lib/services/plan-usage";
import { Badge, Card, EmptyState, FilterBar, PageHeader, Pagination, Table, Td, Th, Tr } from "@/components/ui";
import { Field, Input, Select, Textarea } from "@/components/fields";
import { Modal, ModalForm, SubmitButton } from "@/components/client";
import { buttonClass } from "@/components/ui";
import { setCenterDisabledAction, setCenterOwnBotAction, setCenterPlanAction } from "./actions";
import { managedBotsOn } from "@/lib/managed-bots/service";
import { pageParam } from "@/lib/queries/params";

export const dynamic = "force-dynamic";
const PAGE = 50;

export default async function PlatformPage({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; page?: string }> }) {
  const ctx = await requireCtx();
  if (!ctx.isPlatformAdmin) notFound();
  const { t } = ctx;
  const botsOn = managedBotsOn();
  const sp = await searchParams;
  const q = (sp.q ?? "").trim();
  const digits = q.replace(/\D/g, "");
  const where: Prisma.CenterWhereInput = {
    ...(sp.status === "disabled" ? { disabledAt: { not: null } } : {}),
    ...(q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { slug: { contains: q.toLowerCase() } },
            ...(digits.length >= 4 ? [{ users: { some: { phone: { contains: digits } } } }, { phone: { contains: digits } }] : []),
          ],
        }
      : {}),
  };
  const page = pageParam(sp.page);
  const [total, centers, active, lastActivity, allCenters] = await Promise.all([
    db.center.count({ where }),
    db.center.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE,
      take: PAGE,
      include: {
        users: { where: { role: "OWNER", archivedAt: null }, orderBy: { createdAt: "asc" }, take: 1, select: { name: true, phone: true } },
        _count: { select: { users: { where: { archivedAt: null } } } },
      },
    }),
    activeStudentsByCenter(),
    db.auditLog.groupBy({ by: ["centerId"], _max: { createdAt: true } }),
    db.center.count(),
  ]);
  const last = new Map(lastActivity.map((r) => [r.centerId, r._max.createdAt]));
  const totalActive = [...active.values()].reduce((a, b) => a + b, 0);
  return (
    <>
      <PageHeader title={t("platform.title")} subtitle={t("platform.subtitle", { n: allCenters, active: totalActive })} />
      <FilterBar>
        <Field label={t("common.search")}><Input name="q" defaultValue={q} placeholder={t("platform.search")} className="w-72" /></Field>
        <Field label={t("common.status")}>
          <Select name="status" defaultValue={sp.status ?? ""}>
            <option value="">{t("platform.filter.all")}</option>
            <option value="disabled">{t("platform.filter.disabled")}</option>
          </Select>
        </Field>
        <button type="submit" className={buttonClass("secondary")}>{t("common.filter")}</button>
      </FilterBar>
      <Card pad={false}>
        {centers.length === 0 ? (
          <EmptyState>{t("common.empty")}</EmptyState>
        ) : (
          <Table>
            <thead>
              <tr>
                <Th>{t("common.name")}</Th>
                <Th>{t("platform.owner")}</Th>
                <Th>{t("platform.plan")}</Th>
                <Th className="text-right">{t("platform.students")}</Th>
                <Th className="text-right">{t("platform.staff")}</Th>
                <Th>{t("platform.created")}</Th>
                <Th>{t("platform.lastActivity")}</Th>
                <Th>{t("common.status")}</Th>
                <Th />
              </tr>
            </thead>
            <tbody>
              {centers.map((c) => {
                const owner = c.users[0];
                const plan = isPlan(c.plan) ? c.plan : "FREE";
                const usage = planUsage(plan, active.get(c.id) ?? 0);
                const o = readOnboarding(c.onboarding);
                const self = c.id === ctx.centerId;
                const planForm = (
                  <ModalForm action={setCenterPlanAction} className="space-y-4">
                    <input type="hidden" name="centerId" value={c.id} />
                    <Field label={t("platform.plan")}>
                      <Select name="plan" defaultValue={plan}>
                        {PLAN_NAMES.map((p) => <option key={p} value={p}>{`${t(`plan.${p}`)} · ${t("plan.upTo", { n: planUsage(p, 0).limit })}`}</option>)}
                      </Select>
                    </Field>
                    <SubmitButton>{t("common.save")}</SubmitButton>
                  </ModalForm>
                );
                const statusForm = c.disabledAt ? (
                  <ModalForm action={setCenterDisabledAction} className="space-y-4">
                    <input type="hidden" name="centerId" value={c.id} />
                    <input type="hidden" name="disable" value="0" />
                    <p className="text-sm text-zinc-600">{t("platform.enableText")}</p>
                    <SubmitButton>{t("platform.enable")}</SubmitButton>
                  </ModalForm>
                ) : (
                  <ModalForm action={setCenterDisabledAction} className="space-y-4">
                    <input type="hidden" name="centerId" value={c.id} />
                    <input type="hidden" name="disable" value="1" />
                    <p className="text-sm text-zinc-600">{t("platform.disableText")}</p>
                    <Field label={t("platform.reason")} hint={t("common.optional")}><Textarea name="reason" rows={2} maxLength={500} /></Field>
                    <SubmitButton variant="danger">{t("platform.disable")}</SubmitButton>
                  </ModalForm>
                );
                const ownBotForm = (
                  <ModalForm action={setCenterOwnBotAction} className="space-y-4">
                    <input type="hidden" name="centerId" value={c.id} />
                    <input type="hidden" name="allow" value={c.ownBotAllowed ? "0" : "1"} />
                    <p className="text-sm text-zinc-600">{t("platform.ownBotText")}</p>
                    <SubmitButton variant={c.ownBotAllowed ? "danger" : "primary"}>{t(c.ownBotAllowed ? "platform.ownBotRevoke" : "platform.ownBotAllow")}</SubmitButton>
                  </ModalForm>
                );
                return (
                  <Tr key={c.id}>
                    <Td className="min-w-[200px]">
                      <div className="font-medium text-zinc-900">{c.name}</div>
                      <div className="text-xs text-zinc-500">
                        <Link href={`/f/${c.slug}`} className="underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-900">/f/{c.slug}</Link>
                        {!o.completedAt && ` · ${t("platform.setup", { done: doneCount(o), total: SETUP_STEPS.length })}`}
                      </div>
                    </Td>
                    <Td className="whitespace-nowrap">
                      <div className="text-zinc-900">{owner?.name ?? "—"}</div>
                      <div className="tnum text-xs text-zinc-500">{owner ? formatPhone(owner.phone) : ""}</div>
                    </Td>
                    <Td>{t(`plan.${plan}`)}</Td>
                    <Td className="tnum whitespace-nowrap text-right">
                      {usage.used} / {usage.limit}
                      {usage.level === "over" && <div className="text-xs text-amber-700">{t("platform.overLimit")}</div>}
                    </Td>
                    <Td className="tnum text-right">{c._count.users}</Td>
                    <Td className="tnum whitespace-nowrap">{formatDate(c.createdAt)}</Td>
                    <Td className="tnum whitespace-nowrap">{last.get(c.id) ? formatDateTime(last.get(c.id)!) : "—"}</Td>
                    <Td>
                      {c.disabledAt ? (
                        <span title={c.disabledReason ?? undefined}><Badge tone="gray">{t("platform.disabled")}</Badge></span>
                      ) : (
                        <Badge tone="green">{t("platform.active")}</Badge>
                      )}
                    </Td>
                    <Td className="whitespace-nowrap text-right">
                      <div className="flex justify-end gap-1">
                        <Modal label={t("platform.plan")} title={`${t("platform.changePlan")} · ${c.name}`} variant="secondary" size="sm">{planForm}</Modal>
                        {botsOn && (
                          <Modal label={`${t("platform.ownBot")}${c.ownBotAllowed ? " ✓" : ""}`} title={`${t("platform.ownBot")} · ${c.name}`} variant="ghost" size="sm">{ownBotForm}</Modal>
                        )}
                        {!self && (
                          <Modal label={c.disabledAt ? t("platform.enable") : t("platform.disable")} title={c.name} variant="ghost" size="sm">{statusForm}</Modal>
                        )}
                      </div>
                    </Td>
                  </Tr>
                );
              })}
            </tbody>
          </Table>
        )}
        <Pagination page={page} pages={Math.max(1, Math.ceil(total / PAGE))} params={{ q: sp.q, status: sp.status }} path="/platform" t={t} />
      </Card>
    </>
  );
}
