import Link from "next/link";
import { ArrowRight, Check, TriangleAlert } from "lucide-react";
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
  const where = { centerId: ctx.centerId };
  const [c, usage, courses, groups, students, payments] = await Promise.all([
    db.center.findUniqueOrThrow({ where: { id: ctx.centerId }, select: { onboarding: true } }),
    centerUsage(ctx.centerId),
    db.course.count({ where, take: 1 }),
    db.group.count({ where, take: 1 }),
    db.student.count({ where, take: 1 }),
    db.ledgerEntry.count({ where: { ...where, type: "PAYMENT" }, take: 1 }),
  ]);
  const o = readOnboarding(c.onboarding);
  const showSetup = setupPending(o);
  // after the wizard is done or put off: a checklist from real data until the center has its first payment
  const steps = [
    { done: courses > 0, label: t("start.course"), href: "/courses" },
    { done: groups > 0, label: t("start.group"), href: "/groups/new" },
    { done: students > 0, label: t("start.students"), href: "/students/new" },
    { done: payments > 0, label: t("start.payment"), href: "/students" },
  ];
  const showStart = !showSetup && steps.some((x) => !x.done);
  const planMsg =
    usage.level === "near" ? t("plan.near", { n: usage.remaining }) : usage.level === "full" ? t("plan.full") : usage.level === "over" ? t("plan.over", { n: usage.used - usage.limit }) : null;
  if (!showSetup && !planMsg && !showStart) return null;
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
      {showStart && (
        <section className="rounded-xl border border-line bg-white px-4 py-4">
          <h2 className="text-sm font-semibold text-zinc-950">{t("start.title")}</h2>
          <p className="mt-0.5 text-sm text-zinc-500">{t("start.lead")}</p>
          <ol className="mt-3 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {steps.map((x, i) => (
              <li key={x.href}>
                {x.done ? (
                  <div className="flex h-full items-center gap-2.5 rounded-lg bg-zinc-50 px-3 py-2.5 text-sm text-zinc-500">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-zinc-900 text-white" aria-hidden><Check className="h-3 w-3" /></span>
                    <span className="line-through decoration-zinc-300">{x.label}</span>
                    <span className="sr-only">— {t("start.done")}</span>
                  </div>
                ) : (
                  <Link href={x.href} className="flex h-full items-center gap-2.5 rounded-lg border border-zinc-200 px-3 py-2.5 text-sm font-medium text-zinc-900 transition-colors hover:border-zinc-300 hover:bg-zinc-50">
                    <span className="tnum flex h-5 w-5 shrink-0 items-center justify-center rounded-full border border-zinc-300 text-[11px] text-zinc-600" aria-hidden>{i + 1}</span>
                    {x.label}
                    <ArrowRight className="ml-auto h-3.5 w-3.5 shrink-0 text-zinc-400" aria-hidden />
                  </Link>
                )}
              </li>
            ))}
          </ol>
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
