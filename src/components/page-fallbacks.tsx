// not-found.tsx bodies (audit O3). Server components; language from the lang cookie,
// the same source the root layout uses for <html lang>.
import Link from "next/link";
import { cookies } from "next/headers";
import { SearchX } from "lucide-react";
import { isLocale, LANG_COOKIE } from "@/lib/i18n";
import { uiRu, uiUz } from "@/lib/i18n/extra-ui";
import { buttonClass, cx } from "./ui";

async function strings() {
  const lang = (await cookies()).get(LANG_COOKIE)?.value;
  return isLocale(lang) && lang === "ru" ? uiRu : uiUz;
}

export async function NotFoundView({ home = "/", fullPage = false }: { home?: string; fullPage?: boolean }) {
  const s = await strings();
  return (
    <div className={cx("flex flex-col items-center px-4 text-center", fullPage ? "min-h-screen justify-center py-16" : "py-16")}>
      <SearchX className="h-6 w-6 text-zinc-400" strokeWidth={1.5} aria-hidden />
      <h1 className="mt-3 text-[15px] font-semibold text-zinc-900">{s["fallback.notFoundTitle"]}</h1>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-zinc-500">{s["fallback.notFoundBody"]}</p>
      <Link href={home} className={cx(buttonClass("secondary"), "mt-5")}>{s["fallback.home"]}</Link>
    </div>
  );
}
