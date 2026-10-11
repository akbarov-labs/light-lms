import { cookies } from "next/headers";
import { isLocale, LANG_COOKIE, makeT } from "@/lib/i18n";
import { setLangAction } from "@/app/actions";
import { LoginForm } from "./form";

export const metadata = { title: "Kirish · lms-light" };

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ next?: string }> }) {
  const { next } = await searchParams;
  const lang = (await cookies()).get(LANG_COOKIE)?.value;
  const locale = isLocale(lang) ? lang : "uz";
  const t = makeT(locale);
  return (
    <main className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-6 text-center">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-accent text-lg font-bold text-accent-fg">L</div>
          <h1 className="text-xl font-semibold">{t("auth.title")}</h1>
          <p className="text-sm text-slate-500">{t("app.name")}</p>
        </div>
        <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
          <LoginForm next={next} labels={{ phone: t("auth.phone"), password: t("auth.password"), submit: t("auth.submit") }} />
        </div>
        <form action={setLangAction} className="mt-4 flex justify-center gap-2 text-sm">
          {(["uz", "ru"] as const).map((l) => (
            <button key={l} name="lang" value={l} className={l === locale ? "font-semibold text-slate-900" : "text-slate-500 hover:text-slate-800"}>
              {l === "uz" ? "O'zbekcha" : "Русский"}
            </button>
          ))}
        </form>
      </div>
    </main>
  );
}
