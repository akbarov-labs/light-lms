import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { cookies } from "next/headers";
import { ChevronLeft } from "lucide-react";
import { isLocale, LANG_COOKIE, type Locale } from "@/lib/i18n";
import { BRAND } from "@/config/brand";
import { PLANS, PLAN_NAMES } from "@/lib/plans";
import { formatPhone } from "@/lib/phone";
import { LEGAL } from "../content";
import { COPY } from "@/app/welcome/copy";

type Doc = "offer" | "privacy";
const isDoc = (v: string): v is Doc => v === "offer" || v === "privacy";

async function locale(): Promise<Locale> {
  const v = (await cookies()).get(LANG_COOKIE)?.value;
  return isLocale(v) ? v : "uz";
}

export async function generateMetadata({ params }: { params: Promise<{ doc: string }> }): Promise<Metadata> {
  const { doc } = await params;
  if (!isDoc(doc)) return {};
  return { title: LEGAL[await locale()][doc].title };
}

const money = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");

export default async function LegalPage({ params }: { params: Promise<{ doc: string }> }) {
  const { doc } = await params;
  if (!isDoc(doc)) notFound();
  const lang = await locale();
  const d = LEGAL[lang][doc];
  const ru = lang === "ru";
  const L = BRAND.legal;
  const draft = !L.entity;
  const site = (process.env.MAIN_SITE_URL || process.env.APP_URL || "").replace(/^https?:\/\//, "").replace(/\/$/, "") || BRAND.name;
  const plans = PLAN_NAMES.map((p) =>
    `${COPY[lang].pricing.plans[p]} — ${ru ? "до" : ""} ${money(PLANS[p].limit)} ${ru ? "учеников" : "tagacha o'quvchi"}, ${PLANS[p].monthlyPrice ? `${money(PLANS[p].monthlyPrice)} ${ru ? "сум/мес" : "so'm/oy"}` : ru ? "бесплатно" : "bepul"}`.replace("  ", " "),
  ).join("; ");
  const contacts = [BRAND.contact.phone && formatPhone(BRAND.contact.phone), BRAND.contact.telegram && `Telegram @${BRAND.contact.telegram}`, BRAND.contact.email].filter(Boolean).join(", ") || (ru ? "[контакты]" : "[aloqa ma'lumotlari]");
  const requisites = [
    L.entity || (ru ? "[Название компании]" : "[Kompaniya nomi]"),
    `${ru ? "ИНН" : "STIR"}: ${L.tin || "[...]"}`,
    `${ru ? "Адрес" : "Manzil"}: ${L.address || "[...]"}`,
    `${ru ? "Банк" : "Bank rekvizitlari"}: ${L.bank || "[...]"}`,
    contacts,
  ].join(" · ");
  const fill = (s: string) =>
    s
      .replaceAll("{name}", BRAND.name)
      .replaceAll("{entity}", L.entity || (ru ? "[Название компании]" : "[Kompaniya nomi]"))
      .replaceAll("{site}", site)
      .replaceAll("{plans}", plans)
      .replaceAll("{version}", L.version)
      .replaceAll("{contacts}", contacts)
      .replaceAll("{requisites}", requisites);

  return (
    <div className="min-h-screen bg-white">
      <header className="border-b border-line">
        <div className="mx-auto flex h-14 max-w-3xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="inline-flex items-center gap-1 text-sm text-zinc-500 hover:text-zinc-900">
            <ChevronLeft className="h-4 w-4" aria-hidden />
            {BRAND.name}
          </Link>
          <Link href={doc === "offer" ? "/legal/privacy" : "/legal/offer"} className="text-sm text-zinc-600 hover:text-zinc-900">
            {LEGAL[lang][doc === "offer" ? "privacy" : "offer"].title}
          </Link>
        </div>
      </header>
      <main className="mx-auto max-w-3xl px-4 py-12 sm:px-6">
        <h1 className="text-[32px] font-semibold tracking-[-0.03em] text-zinc-950">{d.title}</h1>
        <p className="mt-2 text-sm text-zinc-500">{ru ? "Редакция от" : "Tahrir sanasi:"} {L.version.split("-").reverse().join(".")} · {L.city}</p>
        {draft && (
          <p className="mt-6 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-800" role="note">
            {ru ? "Черновик: реквизиты компании ещё не заполнены, текст должен проверить юрист." : "Loyiha: kompaniya rekvizitlari hali to'ldirilmagan, matnni yurist tekshirishi kerak."}
          </p>
        )}
        <div className="mt-10 space-y-9">
          {d.sections.map((s) => (
            <section key={s.h}>
              <h2 className="text-[17px] font-semibold text-zinc-950">{s.h}</h2>
              <div className="mt-3 space-y-3">
                {s.p.map((p, i) => (
                  <p key={i} className="max-w-[70ch] text-[15px] leading-relaxed text-zinc-700">{fill(p)}</p>
                ))}
              </div>
            </section>
          ))}
        </div>
      </main>
    </div>
  );
}
