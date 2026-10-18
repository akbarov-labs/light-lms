import type { Metadata, Viewport } from "next";
import { dictFor, type DictKey } from "@/lib/i18n";
import { MiniApp, type MiniLabels } from "./mini-app";

export const metadata: Metadata = { title: "Markaz", robots: { index: false, follow: false } };
export const viewport: Viewport = { width: "device-width", initialScale: 1, maximumScale: 1, viewportFit: "cover" };

const PREFIXES = ["tg.", "attendance.", "rc.rating.", "method.", "enrollment."];

function labels(locale: "uz" | "ru"): MiniLabels {
  const d = dictFor(locale);
  return Object.fromEntries(Object.entries(d).filter(([k]) => PREFIXES.some((p) => k.startsWith(p)))) as Record<DictKey, string>;
}

/** Telegram Mini App shell. Everything personal is loaded client-side with Telegram's signed init data. */
export default function MiniAppPage() {
  return <MiniApp labels={{ uz: labels("uz"), ru: labels("ru") }} />;
}
