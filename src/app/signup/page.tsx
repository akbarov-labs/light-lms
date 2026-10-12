import Link from "next/link";
import { cookies } from "next/headers";
import { isLocale, LANG_COOKIE, makeT } from "@/lib/i18n";
import { setLangAction } from "@/app/actions";
import { SignupForm } from "./form";

export const dynamic = "force-dynamic";
export const metadata = { title: "Markaz yaratish" };

export default async function SignupPage() {
  const lang = (await cookies()).get(LANG_COOKIE)?.value;
  const locale = isLocale(lang) ? lang : "uz";
  const t = makeT(locale);
  const startedAt = new Date().getTime();
  return (
    <main className="flex min-h-screen items-center justify-center px-4 py-10">
      <div className="w-full max-w-md">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-900 text-base font-semibold text-white" aria-hidden>L</div>
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
          />
        </div>
        <p className="mt-5 text-center text-sm text-zinc-500">
          {t("signup.haveAccount")}{" "}
          <Link href="/login" className="font-medium text-zinc-900 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-900">
            {t("signup.login")}
          </Link>
        </p>
        <form action={setLangAction} className="mt-3 flex justify-center gap-1 text-sm">
          {(["uz", "ru"] as const).map((l) => (
            <button key={l} name="lang" value={l} aria-pressed={l === locale} className={l === locale ? "h-10 rounded-lg px-3 font-medium text-zinc-900" : "h-10 rounded-lg px-3 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"}>
              {l === "uz" ? "O'zbekcha" : "Русский"}
            </button>
          ))}
        </form>
      </div>
    </main>
  );
}
