import { redirect } from "next/navigation";
import { BRAND, demoMode, signupHref } from "@/config/brand";
import Link from "next/link";
import { cookies } from "next/headers";
import { isLocale, LANG_COOKIE, makeT } from "@/lib/i18n";
import { LanguageMenu } from "@/components/language-menu";
import { SignupForm } from "./form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Markaz yaratish" };

export default async function SignupPage() {
  const lang = (await cookies()).get(LANG_COOKIE)?.value;
  const locale = isLocale(lang) ? lang : "uz";
  const t = makeT(locale);
  // the demo server sends real signups to the main site
  if (demoMode() && process.env.MAIN_SITE_URL) redirect(signupHref());
  const startedAt = new Date().getTime();
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <Link href="/" aria-label={BRAND.name} className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-900 text-base font-semibold text-white">{BRAND.name.slice(0, 1).toUpperCase()}</Link>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em]">{t("signup.title")}</h1>
          <p className="mt-1 text-sm text-zinc-500">{t("signup.subtitle")}</p>
        </div>
        <div className="rounded-2xl border border-line bg-white p-6">
          <SignupForm
            locale={locale}
            startedAt={startedAt}
            labels={{
              centerName: t("signup.centerName"),
              centerNamePh: t("signup.centerNamePh"),
              ownerName: t("signup.ownerName"),
              phone: t("signup.phone"),
              phoneHint: t("signup.phoneHint"),
              password: t("signup.password"),
              passwordHint: t("signup.passwordHint"),
              language: t("signup.language"),
              submit: t("signup.submit"),
            }}
            consent={{ text: t("legal.consent"), offer: t("legal.offer"), privacy: t("legal.privacy") }}
          />
        </div>
        <p className="mt-5 text-center text-sm text-zinc-500">
          {t("signup.haveAccount")}{" "}
          <Link href="/login" className="font-medium text-zinc-900 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-900">
            {t("signup.login")}
          </Link>
        </p>
        <div className="mt-3 flex justify-center">
          <LanguageMenu current={locale} side="top" align="center" />
        </div>
      </div>
    </main>
  );
}
