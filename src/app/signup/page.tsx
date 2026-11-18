import { redirect } from "next/navigation";
import { BRAND, demoMode, signupClosed, signupHref } from "@/config/brand";
import { LogoMark } from "@/components/logo";
import Link from "next/link";
import { cookies } from "next/headers";
import { isLocale, LANG_COOKIE, makeT, type Locale } from "@/lib/i18n";
import { LanguageMenu } from "@/components/language-menu";
import { SignupForm } from "./form";
import { mainSiteUrl } from "@/lib/env";
import { formatPhone } from "@/lib/phone";

export const dynamic = "force-dynamic";
export const metadata = { title: "Markaz yaratish" };

export default async function SignupPage() {
  const lang = (await cookies()).get(LANG_COOKIE)?.value;
  const locale = isLocale(lang) ? lang : "uz";
  const t = makeT(locale);
  // the demo server sends real signups to the main site
  if (demoMode() && mainSiteUrl()) redirect(signupHref());
  if (signupClosed()) return <SignupClosed t={t} locale={locale} />;
  const startedAt = new Date().getTime();
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <Link href="/" aria-label={BRAND.name} className="mx-auto mb-4 block h-10 w-10"><LogoMark className="h-10 w-10" /></Link>
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

/** A demo server with no main site: the contacts instead of the form (see signupClosed). */
function SignupClosed({ t, locale }: { t: ReturnType<typeof makeT>; locale: Locale }) {
  const { phone, telegram, email } = BRAND.contact;
  const button = "inline-flex h-10 w-full items-center justify-center rounded-lg text-sm font-medium";
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <Link href="/" aria-label={BRAND.name} className="mx-auto mb-4 block h-10 w-10"><LogoMark className="h-10 w-10" /></Link>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em]">{t("signup.closedTitle")}</h1>
        </div>
        <div className="rounded-2xl border border-line bg-white p-6">
          <p className="text-sm leading-relaxed text-zinc-600">{phone || telegram || email ? t("signup.closedBody") : t("signup.closedNoContact")}</p>
          <div className="mt-5 flex flex-col gap-2">
            {telegram && <a href={`https://t.me/${telegram}`} className={`${button} bg-zinc-900 text-white hover:bg-zinc-800`}>Telegram: @{telegram}</a>}
            {phone && <a href={`tel:+${phone}`} className={`${button} border border-line text-zinc-900 hover:bg-zinc-50`}>{formatPhone(phone)}</a>}
            {email && <a href={`mailto:${email}`} className={`${button} border border-line text-zinc-900 hover:bg-zinc-50`}>{email}</a>}
          </div>
        </div>
        <p className="mt-5 text-center text-sm text-zinc-500">
          <Link href="/demo" className="font-medium text-zinc-900 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-900">
            {t("signup.backToDemo")}
          </Link>
        </p>
        <div className="mt-3 flex justify-center">
          <LanguageMenu current={locale} side="top" align="center" />
        </div>
      </div>
    </main>
  );
}
