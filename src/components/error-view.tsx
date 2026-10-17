"use client";
// Error boundary body (error.tsx / global-error.tsx, audit O3): a calm message in the page's
// language, "try again" (re-renders the segment) and a way home. Strings come from i18n/extra-ui —
// a tiny module — so the client bundle doesn't carry the whole dictionary.

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { TriangleAlert } from "lucide-react";
import { uiRu, uiUz } from "@/lib/i18n/extra-ui";
import { buttonClass, cx } from "./ui";

/** UI language: the `lang` cookie (LANG_COOKIE — the root layout's source too), else <html lang>; "uz" until hydrated. */
export function usePageLocale(): "uz" | "ru" {
  return useSyncExternalStore(
    () => () => {},
    () => {
      const cookie = /(?:^|;\s*)lang=(uz|ru)\b/.exec(document.cookie)?.[1];
      return (cookie ?? document.documentElement.lang) === "ru" ? "ru" : "uz";
    },
    () => "uz",
  );
}

export function ErrorView({ error, reset, home = "/", fullPage = false }: { error: Error & { digest?: string }; reset?: () => void; home?: string; fullPage?: boolean }) {
  const s = usePageLocale() === "ru" ? uiRu : uiUz;
  useEffect(() => {
    console.error(error);
  }, [error]);
  return (
    <div role="alert" className={cx("flex flex-col items-center px-4 text-center", fullPage ? "min-h-screen justify-center py-16" : "py-16")}>
      <TriangleAlert className="h-6 w-6 text-zinc-400" strokeWidth={1.5} aria-hidden />
      <h1 className="mt-3 text-[15px] font-semibold text-zinc-900">{s["fallback.errorTitle"]}</h1>
      <p className="mt-1.5 max-w-sm text-sm leading-relaxed text-zinc-500">{s["fallback.errorBody"]}</p>
      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {reset && (
          <button type="button" onClick={() => reset()} className={buttonClass("primary")}>
            {s["fallback.retry"]}
          </button>
        )}
        {/* a plain <a> in the full-page case: the app shell may be what failed */}
        {fullPage ? (
          <a href={home} className={buttonClass("secondary")}>{s["fallback.home"]}</a>
        ) : (
          <Link href={home} className={buttonClass("secondary")}>{s["fallback.home"]}</Link>
        )}
      </div>
      {error.digest && (
        <p className="mt-6 font-mono text-[11px] text-zinc-400">
          {s["fallback.code"]}: {error.digest}
        </p>
      )}
    </div>
  );
}
