import Link from "next/link";
import { cookies } from "next/headers";
import { isLocale, LANG_COOKIE, makeT } from "@/lib/i18n";
import { setLangAction } from "@/app/actions";
import { LoginForm } from "./form";
import { AuthCard } from "./auth-card";

export const metadata = { title: "Kirish" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string; disabled?: string }> }) {
  const { next, reset, disabled } = await searchParams;
  const lang = (await cookies()).get(LANG_COOKIE)?.value;
  const locale = isLocale(lang) ? lang : "uz";
  const t = makeT(locale);
  return (
    <AuthCard
      title={t("auth.title")}
      subtitle={t("app.name")}
      footer={
        <>
          <div className="mt-4 text-center">
            <Link href="/login/reset" className="text-sm text-zinc-600 underline-offset-4 hover:text-zinc-900 hover:underline">{t("auth.forgot")}</Link>
          </div>
          <p className="mt-3 text-center text-sm text-zinc-500">
            {t("auth.noCenter")}{" "}
            <Link href="/signup" className="font-medium text-zinc-900 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-900">
              {t("auth.createCenter")}
            </Link>
          </p>
          <form action={setLangAction} className="mt-3 flex justify-center gap-1 text-sm">
            {(["uz", "ru"] as const).map((l) => (
              <button key={l} name="lang" value={l} aria-pressed={l === locale} className={l === locale ? "h-10 rounded-lg px-3 font-medium text-zinc-900" : "h-10 rounded-lg px-3 text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900"}>
                {l === "uz" ? "O'zbekcha" : "Русский"}
              </button>
            ))}
          </form>
        </>
      }
    >
      {disabled && <p className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800" role="alert">{t("auth.centerDisabled")}</p>}
      {reset && <p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800" role="status">{t("auth.passwordUpdated")}</p>}
      <LoginForm next={next} labels={{ phone: t("auth.phone"), password: t("auth.password"), submit: t("auth.submit") }} />
    </AuthCard>
  );
}
