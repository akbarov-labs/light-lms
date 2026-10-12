import { requireStaff } from "@/lib/ctx";
import { formatMoney } from "@/lib/money";
import { PLAN_NAMES, PLANS } from "@/lib/plans";
import { centerUsage } from "@/lib/services/plan-usage";
import { Badge, Card, cx, Table, Td, Th, Tr } from "@/components/ui";

export default async function PlanSettings() {
  const ctx = await requireStaff("settings");
  const { t } = ctx;
  const u = await centerUsage(ctx.centerId);
  const warn = u.level !== "ok";
  const note = u.level === "near" ? t("plan.near", { n: u.remaining }) : u.level === "full" ? t("plan.full") : u.level === "over" ? t("plan.over", { n: u.used - u.limit }) : null;
  return (
    <div className="space-y-4">
      <Card title={t("plan.current")}>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <div className="text-[22px] font-semibold tracking-[-0.02em] text-zinc-950">{t(`plan.${u.plan}`)}</div>
          <div className="tnum text-sm text-zinc-700">{t("plan.usage", { used: u.used, limit: u.limit })}</div>
        </div>
        <div
          className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-100"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={u.limit}
          aria-valuenow={Math.min(u.used, u.limit)}
          aria-label={t("plan.usage", { used: u.used, limit: u.limit })}
        >
          <div className={cx("h-full rounded-full", warn ? "bg-amber-500" : "bg-zinc-900")} style={{ width: `${u.percent}%` }} />
        </div>
        {note && <p className="mt-3 text-sm text-amber-800">{note}</p>}
        <p className="mt-3 text-xs text-zinc-500">{t("plan.activeHint")}</p>
        <p className="mt-1 text-xs text-zinc-500">{t("plan.howToChange")}</p>
      </Card>
      <Card title={t("plan.title")} pad={false}>
        <Table>
          <thead>
            <tr>
              <Th>{t("plan.title")}</Th>
              <Th>{t("platform.students")}</Th>
              <Th className="text-right">{t("common.price")}</Th>
            </tr>
          </thead>
          <tbody>
            {PLAN_NAMES.map((p) => (
              <Tr key={p}>
                <Td>
                  <span className="font-medium text-zinc-900">{t(`plan.${p}`)}</span>
                  {p === u.plan && <span className="ml-2"><Badge tone="green">{t("plan.yours")}</Badge></span>}
                </Td>
                <Td className="tnum">{t("plan.upTo", { n: PLANS[p].limit })}</Td>
                <Td className="tnum text-right">{PLANS[p].monthlyPrice ? t("plan.perMonth", { price: formatMoney(PLANS[p].monthlyPrice) }) : t("plan.free")}</Td>
              </Tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </div>
  );
}
