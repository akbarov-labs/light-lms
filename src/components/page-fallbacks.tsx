// not-found.tsx and loading.tsx bodies (audit O3). Server components; language from the lang cookie,
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

const bar = "rounded-md bg-zinc-200/70 motion-safe:animate-pulse";

/** Quiet placeholder in the shape of a list page: title, a row of stats, a table card. */
export async function PageSkeleton({ stats = true, rows = 6 }: { stats?: boolean; rows?: number }) {
  const s = await strings();
  return (
    <div role="status" aria-live="polite" aria-busy="true">
      <span className="sr-only">{s["fallback.loading"]}</span>
      <div className="mb-6" aria-hidden>
        <div className={cx(bar, "h-6 w-48")} />
        <div className={cx(bar, "mt-2 h-4 w-28")} />
      </div>
      {stats && (
        <div className="mb-4 grid grid-cols-2 gap-3 xl:grid-cols-4" aria-hidden>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} className="rounded-xl border border-line bg-white px-4 py-3.5">
              <div className={cx(bar, "h-3.5 w-20")} />
              <div className={cx(bar, "mt-2 h-5 w-28")} />
            </div>
          ))}
        </div>
      )}
      <div className="overflow-hidden rounded-xl border border-line bg-white" aria-hidden>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="flex items-center gap-4 border-b border-zinc-100 px-4 py-3 last:border-0">
            <div className={cx(bar, "h-4 w-1/3")} />
            <div className={cx(bar, "h-4 w-1/5")} />
            <div className={cx(bar, "ml-auto h-4 w-16")} />
          </div>
        ))}
      </div>
    </div>
  );
}
