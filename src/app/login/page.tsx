import { cookies } from "next/headers";
import { isLocale, LANG_COOKIE, makeT } from "@/lib/i18n";
import { setLangAction } from "@/app/actions";
import { LoginForm } from "./form";

export const metadata = { title: "Kirish" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const lang = (await cookies()).get(LANG_COOKIE)?.value;
  const locale = isLocale(lang) ? lang : "uz";
  const t = makeT(locale);
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-4 flex h-10 w-10 items-center justify-center rounded-xl bg-zinc-900 text-base font-semibold text-white" aria-hidden>L</div>
          <h1 className="text-[22px] font-semibold tracking-[-0.02em]">{t("auth.title")}</h1>
          <p className="mt-1 text-sm text-zinc-500">{t("app.name")}</p>
        </div>
        <div className="rounded-2xl border border-line bg-white p-6">
          <LoginForm next={next} labels={{ phone: t("auth.phone"), password: t("auth.password"), submit: t("auth.submit") }} />
        </div>
        <form action={setLangAction} className="mt-5 flex justify-center gap-1 text-sm">
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
