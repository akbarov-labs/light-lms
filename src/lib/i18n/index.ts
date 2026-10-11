import { uz, type DictKey } from "./uz";
import { ru } from "./ru";

export type Locale = "uz" | "ru";
export const LOCALES: Locale[] = ["uz", "ru"];
export const LANG_COOKIE = "lang";
export type { DictKey };

const dicts: Record<Locale, Record<DictKey, string>> = { uz, ru };

export type TFn = (key: DictKey, vars?: Record<string, string | number>) => string;

export function isLocale(v: unknown): v is Locale {
  return v === "uz" || v === "ru";
}

export function makeT(locale: Locale): TFn {
  const dict = dicts[locale] ?? uz;
  return (key, vars) => {
    let s: string = dict[key] ?? uz[key] ?? key;
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
    return s;
  };
}

export function dictFor(locale: Locale): Record<DictKey, string> {
  return dicts[locale] ?? uz;
}
