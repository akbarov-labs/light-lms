import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { accentVars } from "@/lib/color";
import { isLocale, makeT } from "@/lib/i18n";
import { PublicLeadForm } from "./form";
import { LanguageMenu } from "@/components/language-menu";

export const dynamic = "force-dynamic";

export default async function PublicLeadPage({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { slug } = await params;
  const sp = await searchParams;
  const center = await db.center.findUnique({ where: { slug }, include: { courses: { where: { archivedAt: null }, select: { id: true, name: true }, orderBy: { name: "asc" } } } });
  if (!center || center.disabledAt) notFound();
  const lang = isLocale(sp.lang) ? sp.lang : isLocale(center.locale) ? center.locale : "uz";
  const t = makeT(lang);
  const utm = Object.fromEntries(Object.entries(sp).filter(([k, v]) => k.startsWith("utm_") && v)) as Record<string, string>;
  return (
    <main style={accentVars(center.accentColor) as React.CSSProperties} className="flex min-h-screen items-start justify-center px-4 py-10 sm:items-center">
      <div className="w-full max-w-md">
        <div className="mb-5 text-center">
          {center.logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={center.logoUrl} alt="" className="mx-auto mb-3 h-14 w-14 rounded-xl object-cover" />
          ) : (
            <div className="mx-auto mb-3 flex h-14 w-14 items-center justify-center rounded-xl bg-accent text-xl font-bold text-accent-fg">{center.name.slice(0, 1)}</div>
          )}
          <h1 className="text-xl font-semibold">{center.name}</h1>
          <p className="mt-1 text-sm text-zinc-500">{t("leads.formHint")}</p>
        </div>
        <div className="rounded-xl border border-zinc-200 bg-white p-5 shadow-xs">
          <h2 className="mb-3 font-medium">{t("leads.formTitle")}</h2>
          <PublicLeadForm
            slug={slug}
            lang={lang}
            courses={center.courses}
            utm={utm}
            l={{ name: t("leads.formName"), phone: t("leads.formPhone"), course: t("leads.interestedCourse"), comment: t("leads.formComment"), submit: t("leads.formSubmit"), thanks: t("leads.formThanks") }}
          />
        </div>
        <div className="mt-3 flex justify-center">
          <LanguageMenu current={lang} side="top" align="center" hrefs={{ uz: `?${new URLSearchParams({ ...utm, lang: "uz" })}`, ru: `?${new URLSearchParams({ ...utm, lang: "ru" })}` }} />
        </div>
      </div>
    </main>
  );
}
