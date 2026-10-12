import Link from "next/link";
import { ArrowRight, TriangleAlert } from "lucide-react";
import type { Ctx } from "@/lib/ctx";
import { db } from "@/lib/db";
import { doneCount, readOnboarding, SETUP_STEPS, setupPending } from "@/lib/onboarding";
import { centerUsage } from "@/lib/services/plan-usage";
import { dismissSetupAction } from "@/app/(admin)/setup/actions";
import { LinkButton } from "./ui";

/** Owner-only notices above the dashboard: unfinished setup wizard, plan limit close or reached. */
export async function OwnerNotices({ ctx }: { ctx: Ctx }) {
  if (!ctx.can("settings")) return null;
  const { t } = ctx;
  const [c, usage] = await Promise.all([db.center.findUniqueOrThrow({ where: { id: ctx.centerId }, select: { onboarding: true } }), centerUsage(ctx.centerId)]);
  const o = readOnboarding(c.onboarding);
  const showSetup = setupPending(o);
  const planMsg =
    usage.level === "near" ? t("plan.near", { n: usage.remaining }) : usage.level === "full" ? t("plan.full") : usage.level === "over" ? t("plan.over", { n: usage.used - usage.limit }) : null;
  if (!showSetup && !planMsg) return null;
  return (
    <div className="mb-4 space-y-3">
      {showSetup && (
        <section className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-line bg-white px-4 py-3.5">
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-zinc-950">{t("setup.bannerTitle")}</h2>
            <p className="mt-0.5 text-sm text-zinc-500">{t("setup.bannerText", { done: doneCount(o), total: SETUP_STEPS.length })}</p>
          </div>
          <div className="flex items-center gap-2">
            <form action={dismissSetupAction}>
              <button type="submit" className="inline-flex h-9 items-center rounded-lg px-3.5 text-sm font-medium text-zinc-600 transition-colors hover:bg-zinc-100 hover:text-zinc-900">{t("setup.bannerHide")}</button>
            </form>
            <LinkButton href="/setup">
              {t("setup.bannerCta")}
              <ArrowRight className="h-4 w-4" aria-hidden />
            </LinkButton>
          </div>
        </section>
      )}
      {planMsg && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-900" role="status">
          <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <span>
            {t("plan.usage", { used: usage.used, limit: usage.limit })} · {planMsg}{" "}
            <Link href="/settings/plan" className="font-medium underline decoration-amber-300 underline-offset-2 hover:decoration-amber-900">{t("plan.title")}</Link>
          </span>
        </p>
      )}
    </div>
  );
}
