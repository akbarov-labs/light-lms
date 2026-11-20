import { dictFor, type DictKey } from "@/lib/i18n";
import type { MiniLabels } from "../mini-app";

/** The Mini App test pages' strings, both languages (the language is known only after the first call). */
export function quizLabels(): { uz: MiniLabels; ru: MiniLabels } {
  const pick = (l: "uz" | "ru") => Object.fromEntries(Object.entries(dictFor(l)).filter(([k]) => k.startsWith("quiz.tg."))) as Record<DictKey, string>;
  return { uz: pick("uz"), ru: pick("ru") };
}
