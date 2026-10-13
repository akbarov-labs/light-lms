"use client";

import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { Check, ChevronDown, Languages } from "lucide-react";
import { setLangAction } from "@/app/actions";
import { cx } from "./ui";

type Locale = "uz" | "ru";
const LOCALES: Locale[] = ["uz", "ru"];
// Each language is named in its own script, so the way back is readable from either side.
const NAME: Record<Locale, string> = { uz: "O'zbekcha", ru: "Русский" };
const CODE: Record<Locale, string> = { uz: "UZ", ru: "RU" };
// The trigger is announced in both languages: whoever needs it may not read the current one.
const LABEL = "Til · Язык";

const item = "flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm transition-colors focus-visible:bg-zinc-100 focus-visible:outline-none";

/**
 * Language rows as menu radios. Submits through setLangAction, or follows `hrefs` (public pages that keep the language
 * in the URL). Submit buttons never close their menu on click (that would unmount the form before it posts); the menu
 * closes when the new language arrives.
 */
export function LanguageOptions({ current, hrefs, onPick }: { current: Locale; hrefs?: Record<Locale, string>; onPick?: () => void }) {
  const rows = LOCALES.map((l) => {
    const on = l === current;
    const body = (
      <>
        <span lang={l} className="flex-1">{NAME[l]}</span>
        {on && <Check className="h-4 w-4 text-zinc-900" aria-hidden />}
      </>
    );
    const cls = cx(item, on ? "font-medium text-zinc-950" : "text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950");
    return hrefs ? (
      <a key={l} href={hrefs[l]} role="menuitemradio" aria-checked={on} className={cls} onClick={onPick}>
        {body}
      </a>
    ) : (
      <button key={l} name="lang" value={l} role="menuitemradio" aria-checked={on} className={cls}>
        {body}
      </button>
    );
  });
  return hrefs ? <>{rows}</> : <form action={setLangAction}>{rows}</form>;
}

/**
 * The one language picker: a quiet trigger (icon, current language, chevron) that opens a small menu.
 * `compact` shows the two-letter code for tight headers; `side="top"` for pickers at the foot of a page.
 */
export function LanguageMenu({ current, compact, side = "bottom", align = "end", hrefs }: { current: Locale; compact?: boolean; side?: "top" | "bottom"; align?: "start" | "center" | "end"; hrefs?: Record<Locale, string> }) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const menuId = useId();

  useEffect(() => setOpen(false), [current]);

  useEffect(() => {
    if (!open) return;
    // start on the current language, like a native select
    wrap.current?.querySelector<HTMLElement>('[aria-checked="true"]')?.focus();
    const off = (e: MouseEvent) => !wrap.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("mousedown", off);
    return () => document.removeEventListener("mousedown", off);
  }, [open]);

  const close = (refocus: boolean) => {
    setOpen(false);
    if (refocus) trigger.current?.focus();
  };

  const onMenuKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const items = [...(wrap.current?.querySelectorAll<HTMLElement>('[role="menuitemradio"]') ?? [])];
    const i = items.indexOf(document.activeElement as HTMLElement);
    if (e.key === "Escape") { e.preventDefault(); close(true); }
    else if (e.key === "Tab") close(false);
    else if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length]?.focus(); }
    else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length]?.focus(); }
    else if (e.key === "Home") { e.preventDefault(); items[0]?.focus(); }
    else if (e.key === "End") { e.preventDefault(); items[items.length - 1]?.focus(); }
  };

  return (
    <div ref={wrap} className="relative inline-block">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") { e.preventDefault(); setOpen(true); }
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={`${LABEL}: ${NAME[current]}`}
        className={cx(
          "inline-flex h-9 items-center gap-1.5 rounded-lg text-[13px] font-medium transition-colors",
          compact ? "px-2 sm:px-2.5" : "px-2.5",
          open ? "bg-zinc-100 text-zinc-950" : "text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950",
        )}
      >
        <Languages className="h-4 w-4 text-zinc-500" aria-hidden />
        <span lang={current}>{compact ? CODE[current] : NAME[current]}</span>
        <ChevronDown className={cx("h-3.5 w-3.5 text-zinc-500 transition-transform duration-150", open && "rotate-180", compact && "hidden sm:block")} aria-hidden />
      </button>
      {open && (
        <div
          id={menuId}
          role="menu"
          aria-label={LABEL}
          onKeyDown={onMenuKey}
          className={cx(
            "absolute z-40 w-44 animate-pop-in rounded-xl border border-line bg-white p-1.5 text-left shadow-pop",
            side === "top" ? "bottom-full mb-1.5" : "top-full mt-1.5",
            align === "end" ? "right-0" : align === "start" ? "left-0" : "left-1/2 -translate-x-1/2",
          )}
        >
          <LanguageOptions current={current} hrefs={hrefs} onPick={() => close(false)} />
        </div>
      )}
    </div>
  );
}
