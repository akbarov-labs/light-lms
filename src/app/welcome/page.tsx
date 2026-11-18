import type { Metadata } from "next";
import type { ReactNode } from "react";
import Link from "next/link";
import { cookies } from "next/headers";
import { Check, ChevronRight, FileSpreadsheet, Plus, Send } from "lucide-react";
import { isLocale, LANG_COOKIE, type Locale } from "@/lib/i18n";
import { BRAND, demoHref } from "@/config/brand";
import { PLANS } from "@/lib/plans";
import { formatPhone } from "@/lib/phone";
import { cx } from "@/components/ui";
import { LogoMark, Wordmark } from "@/components/logo";
import { contactTelegram } from "@/lib/contact-telegram";
import { LanguageMenu } from "@/components/language-menu";
import { COPY, type Copy } from "./copy";
import { PayDemo } from "./pay-demo";

async function locale(): Promise<Locale> {
  const v = (await cookies()).get(LANG_COOKIE)?.value;
  return isLocale(v) ? v : "uz";
}

export async function generateMetadata(): Promise<Metadata> {
  const c = COPY[await locale()];
  return { title: { absolute: `${BRAND.name} — ${c.metaTitle}` }, description: c.metaDesc };
}

const money = (n: number) => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
const primary = "inline-flex h-11 items-center justify-center gap-1.5 rounded-lg bg-zinc-900 px-5 text-sm font-medium text-white transition-colors hover:bg-zinc-800";
const secondary = "inline-flex h-11 items-center justify-center gap-1.5 rounded-lg border border-zinc-200 bg-white px-5 text-sm font-medium text-zinc-800 transition-colors hover:border-zinc-300 hover:bg-zinc-50";

function Mark({ className = "h-8 w-8" }: { className?: string }) {
  return <LogoMark className={cx("shrink-0", className)} />;
}

/** A feature told by the UI doing it: text on one side, the real interface fragment on the other. */
function Feature({ title, body, children, flip }: { title: string; body: string; children: ReactNode; flip?: boolean }) {
  return (
    <div className="grid items-center gap-8 py-14 lg:grid-cols-2 lg:gap-16 lg:py-20">
      <div className={cx("max-w-md", flip && "lg:order-2")}>
        <h3 className="text-[22px] font-semibold leading-tight tracking-[-0.02em] text-zinc-950 sm:text-2xl sm:leading-8">{title}</h3>
        <p className="mt-3 text-[15px] leading-relaxed text-zinc-600">{body}</p>
      </div>
      <div className={cx("flex justify-center", flip ? "lg:order-1 lg:justify-start" : "lg:justify-end")}>{children}</div>
    </div>
  );
}

function LeadsBoard({ c }: { c: Copy["day"]["leads"] }) {
  const cols: [string, number, [string, string][]][] = [
    [c.cols[0], 4, [["Nodira Yusupova", "Instagram"], ["Javohir Aliyev", "Sayt"]]],
    [c.cols[1], 2, [["Kamola Ergasheva", "IELTS · 14.10"], ["Sherzod Qodirov", "A1 · 15.10"]]],
    [c.cols[2], 9, [["Madina Rustamova", "IELTS 7.0 #3"]]],
  ];
  return (
    <div className="grid w-full max-w-[520px] grid-cols-3 gap-2 rounded-2xl border border-line bg-zinc-50 p-2.5">
      {cols.map(([name, count, cards], i) => (
        <div key={name} className="min-w-0">
          <div className="mb-2 flex items-center justify-between px-1.5 pt-1 text-xs font-medium text-zinc-500">
            <span className="truncate">{name}</span>
            <span className="tnum">{count}</span>
          </div>
          <div className="space-y-1.5">
            {cards.map(([who, sub]) => (
              <div key={who} className={cx("rounded-lg border bg-white px-2.5 py-2", i === 2 ? "border-emerald-200" : "border-line")}>
                <div className="truncate text-[13px] font-medium text-zinc-900">{who}</div>
                <div className="truncate text-[11px] text-zinc-500">{sub}</div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function AttendancePhone({ c }: { c: Copy["day"]["attendance"] }) {
  const rows: [string, "p" | "a" | "l"][] = [
    ["Yasmina A.", "p"],
    ["Otabek F.", "p"],
    ["Temur M.", "a"],
    ["Feruza R.", "l"],
    ["Ulug'bek S.", "p"],
  ];
  // impeccable-disable-next-line gray-on-color: near-black on amber-400 is 11:1, not gray text
  const tone = { p: "bg-emerald-700 text-white", a: "bg-red-600 text-white", l: "bg-amber-400 text-zinc-950" };
  return (
    <div className="w-[320px] max-w-full rounded-[30px] border border-zinc-300 bg-zinc-900 p-2 shadow-[0_24px_60px_-30px_rgb(9_9_11/0.45)]">
      <div className="overflow-hidden rounded-[23px] bg-white">
        <div className="border-b border-zinc-100 px-4 pb-3 pt-5">
          <div className="text-[13px] font-semibold text-zinc-900">{c.lesson}</div>
        </div>
        <ul className="divide-y divide-zinc-100">
          {rows.map(([name, s]) => (
            <li key={name} className="flex items-center justify-between gap-2 px-4 py-2.5">
              <span className="truncate text-[13px] text-zinc-800">{name}</span>
              <span className="flex shrink-0 gap-1">
                {(["p", "a", "l"] as const).map((k) => (
                  <span key={k} className={cx("flex h-7 items-center rounded-md px-2 text-[11px] font-medium", k === s ? tone[k] : "bg-zinc-100 text-zinc-600")}>
                    {k === "p" ? c.present : k === "a" ? c.absent : c.late}
                  </span>
                ))}
              </span>
            </li>
          ))}
        </ul>
        <div className="border-t border-zinc-100 p-3">
          <div className="flex h-10 items-center justify-center rounded-lg bg-zinc-900 text-sm font-medium text-white">{c.save}</div>
        </div>
      </div>
    </div>
  );
}

function BotChat({ c }: { c: Copy["day"]["debts"] }) {
  return (
    <div className="w-full max-w-[400px] rounded-2xl border border-line bg-[#EEF1F4] p-4">
      <div className="mb-3 flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-full bg-zinc-900 text-white" aria-hidden><Send className="h-4 w-4" /></span>
        <div className="text-sm font-semibold text-zinc-900">{c.botName}</div>
      </div>
      <div className="max-w-[320px] rounded-2xl rounded-tl-md bg-white px-3.5 py-2.5 text-[14px] leading-snug text-zinc-800 shadow-xs">
        {c.message}
        <div className="mt-1 text-right text-[11px] text-zinc-500">10:00</div>
      </div>
      <div className="mt-1.5 grid max-w-[320px] grid-cols-2 gap-1.5">
        <span className="flex h-9 items-center justify-center rounded-lg bg-white/70 text-[13px] font-medium text-zinc-800">{c.payBtn}</span>
        <span className="flex h-9 items-center justify-center rounded-lg bg-white/70 text-[13px] font-medium text-zinc-800">{c.balanceBtn}</span>
      </div>
    </div>
  );
}

function Payslip({ c }: { c: Copy["day"]["salary"] }) {
  return (
    <div className="w-full max-w-[420px] overflow-hidden rounded-2xl border border-line bg-white">
      <div className="border-b border-zinc-100 px-5 py-3 text-[13px] font-semibold text-zinc-900">{c.teacher}</div>
      <dl className="divide-y divide-zinc-100 text-sm">
        {c.lines.map(([k, v]) => (
          <div key={k} className="flex justify-between gap-4 px-5 py-2.5">
            <dt className="text-zinc-500">{k}</dt>
            <dd className="tnum text-zinc-800">{v}</dd>
          </div>
        ))}
        <div className="flex justify-between gap-4 bg-zinc-50 px-5 py-3">
          <dt className="font-medium text-zinc-900">{c.total}</dt>
          <dd className="tnum font-semibold text-zinc-950">{c.totalValue}</dd>
        </div>
      </dl>
    </div>
  );
}

function ImportPreview() {
  const rows = [
    ["Aliyeva Sevinch", "90 111 22 33", "A1 #4", "−450 000"],
    ["Karimov Diyor", "93 444 55 66", "IELTS #3", "0"],
    ["Usmonova Laylo", "97 777 88 99", "Kids #2", "+200 000"],
  ];
  return (
    <div className="w-full max-w-[460px] overflow-hidden rounded-2xl border border-line bg-white">
      <div className="flex items-center gap-2 border-b border-zinc-100 px-4 py-2.5 text-[13px] font-medium text-zinc-700">
        <FileSpreadsheet className="h-4 w-4 text-emerald-700" aria-hidden />
        oquvchilar.csv
      </div>
      <table className="w-full text-[12px]">
        <tbody>
          {rows.map((r) => (
            <tr key={r[0]} className="border-b border-zinc-100 last:border-0">
              {r.map((v, i) => (
                <td key={i} className={cx("whitespace-nowrap px-3 py-2 first:pl-4 last:pr-4", i === 3 ? "tnum text-right" : "text-zinc-700", i === 3 && v.startsWith("−") && "text-red-600", i === 3 && v.startsWith("+") && "text-emerald-700", i === 1 && "hidden sm:table-cell")}>
                  {v}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default async function WelcomePage() {
  const lang = await locale();
  const c = COPY[lang];
  const demo = demoHref();
  const tg = await contactTelegram();
  const planOrder = ["FREE", "START", "GROWTH", "PRO"] as const;

  return (
    <div className="min-h-screen bg-white text-zinc-900">
      {/* header */}
      <header className="sticky top-0 z-30 border-b border-line/70 bg-white/85 backdrop-blur-md">
        <div className="mx-auto flex h-16 max-w-[1200px] items-center gap-4 px-4 sm:gap-6 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <Mark />
            <Wordmark name={BRAND.name} className="hidden whitespace-nowrap text-[17px] font-semibold tracking-[-0.02em] min-[420px]:inline" />
          </Link>
          <nav className="hidden items-center gap-1 text-sm text-zinc-600 md:flex" aria-label={c.nav.features}>
            <a href="#features" className="rounded-md px-2.5 py-1.5 hover:text-zinc-950">{c.nav.features}</a>
            <a href="#pricing" className="rounded-md px-2.5 py-1.5 hover:text-zinc-950">{c.nav.pricing}</a>
            <a href="#faq" className="rounded-md px-2.5 py-1.5 hover:text-zinc-950">{c.nav.faq}</a>
          </nav>
          <div className="ml-auto flex items-center gap-1 sm:gap-2">
            <LanguageMenu current={lang} compact />
            <Link href="/login" className="inline-flex h-9 items-center whitespace-nowrap rounded-lg px-2 text-sm font-medium text-zinc-700 hover:bg-zinc-100 hover:text-zinc-950 sm:px-3">{c.nav.login}</Link>
            <Link href="/signup" className="inline-flex h-9 items-center whitespace-nowrap rounded-lg bg-zinc-900 px-3 text-sm font-medium text-white hover:bg-zinc-800 sm:px-3.5">{c.nav.start}</Link>
          </div>
        </div>
      </header>

      <main>
        {/* first viewport: the promise, and the promise working */}
        <section className="border-b border-line bg-[linear-gradient(to_bottom,#fff,#FAFAFA)]">
          <div className="mx-auto grid max-w-[1200px] items-center gap-12 px-4 pb-16 pt-12 sm:px-6 lg:grid-cols-[1.05fr_1fr] lg:gap-16 lg:pb-24 lg:pt-20">
            <div>
              <h1 className="max-w-[14ch] text-[40px] font-semibold leading-[1.05] tracking-[-0.035em] text-zinc-950 sm:text-[52px] lg:text-[60px]">{c.hero.title}</h1>
              <p className="mt-5 max-w-136 text-[17px] leading-relaxed text-zinc-600">{c.hero.lead}</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/signup" className={primary}>{c.hero.start}<ChevronRight className="h-4 w-4" aria-hidden /></Link>
                {demo && <a href={demo} className={secondary}>{c.hero.demo}</a>}
              </div>
              <p className="mt-4 text-[13px] text-zinc-500">{c.hero.note}</p>
            </div>
            <div className="flex justify-center lg:justify-end">
              <PayDemo c={c.pay} center="Demo O'quv Markazi" />
            </div>
          </div>
        </section>

        {/* a day at the front desk */}
        <section id="features" className="scroll-mt-16">
          <div className="mx-auto max-w-[1200px] px-4 pt-20 sm:px-6 lg:pt-28">
            <h2 className="max-w-[20ch] text-[32px] font-semibold leading-[1.1] tracking-[-0.03em] text-zinc-950 sm:text-[40px]">{c.day.title}</h2>
            <p className="mt-4 max-w-xl text-[17px] leading-relaxed text-zinc-600">{c.day.lead}</p>
            <div className="mt-6 divide-y divide-line">
              <Feature title={c.day.leads.title} body={c.day.leads.body}><LeadsBoard c={c.day.leads} /></Feature>
              <Feature title={c.day.attendance.title} body={c.day.attendance.body} flip><AttendancePhone c={c.day.attendance} /></Feature>
              <Feature title={c.day.debts.title} body={c.day.debts.body}><BotChat c={c.day.debts} /></Feature>
              <Feature title={c.day.salary.title} body={c.day.salary.body} flip><Payslip c={c.day.salary} /></Feature>
            </div>
          </div>
        </section>

        {/* why the money is right */}
        <section className="border-y border-line bg-canvas">
          <div className="mx-auto grid max-w-[1200px] gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_1.6fr] lg:gap-16 lg:py-28">
            <div className="lg:sticky lg:top-28 lg:self-start">
              <h2 className="max-w-[16ch] text-[32px] font-semibold leading-[1.1] tracking-[-0.03em] text-zinc-950 sm:text-[40px]">{c.trust.title}</h2>
              <p className="mt-4 max-w-sm text-[17px] leading-relaxed text-zinc-600">{c.trust.lead}</p>
            </div>
            <dl className="grid gap-x-10 sm:grid-cols-2">
              {c.trust.items.map(([k, v]) => (
                <div key={k} className="border-t border-zinc-200 py-6">
                  <dt className="flex items-center gap-2 text-[15px] font-semibold text-zinc-950">
                    <Check className="h-4 w-4 shrink-0 text-zinc-900" aria-hidden />
                    {k}
                  </dt>
                  <dd className="mt-2 text-[14px] leading-relaxed text-zinc-600">{v}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>

        {/* moving in */}
        <section className="mx-auto max-w-[1200px] px-4 sm:px-6">
          <Feature title={c.move.title} body={c.move.body}><ImportPreview /></Feature>
        </section>

        {/* pricing */}
        <section id="pricing" className="scroll-mt-16 border-t border-line">
          <div className="mx-auto max-w-[1200px] px-4 py-20 sm:px-6 lg:py-28">
            <h2 className="text-[32px] font-semibold leading-[1.1] tracking-[-0.03em] text-zinc-950 sm:text-[40px]">{c.pricing.title}</h2>
            <p className="mt-4 max-w-xl text-[17px] leading-relaxed text-zinc-600">{c.pricing.lead}</p>
            <div className="mt-10 flex flex-col gap-4 rounded-2xl border border-zinc-900 bg-zinc-950 p-6 text-white sm:flex-row sm:items-center sm:justify-between sm:p-7">
              <div className="max-w-2xl">
                <div className="text-xs font-medium uppercase tracking-[0.12em] text-zinc-400">{c.pricing.founding.badge}</div>
                <div className="mt-2 text-lg font-semibold leading-snug tracking-[-0.01em] sm:text-xl">{c.pricing.founding.title}</div>
                <p className="mt-2 text-sm leading-relaxed text-zinc-300">{c.pricing.founding.body}</p>
              </div>
              <a href={tg ? `https://t.me/${tg}` : BRAND.contact.phone ? `tel:+${BRAND.contact.phone}` : "/signup"} className="inline-flex h-10 shrink-0 items-center justify-center rounded-lg bg-white px-4 text-sm font-medium text-zinc-950 hover:bg-zinc-100">{c.pricing.founding.cta}</a>
            </div>
            <div className="mt-4 overflow-hidden rounded-2xl border border-line">
              <div className="grid gap-px bg-line sm:grid-cols-2 lg:grid-cols-4">
                {planOrder.map((p) => {
                  const plan = PLANS[p];
                  return (
                    <div key={p} className="flex flex-col bg-white p-6">
                      <div className="text-sm font-medium text-zinc-900">{c.pricing.plans[p]}</div>
                      <div className="mt-4 flex items-baseline gap-1.5">
                        <span className="tnum text-[32px] font-semibold tracking-[-0.03em] text-zinc-950">{money(plan.monthlyPrice)}</span>
                        <span className="text-[13px] text-zinc-500">{c.pricing.month}</span>
                      </div>
                      <div className="mt-1 text-sm text-zinc-600">{c.pricing.students.replace("{n}", money(plan.limit))}</div>
                      <Link href="/signup" className={cx(p === "FREE" ? primary : secondary, "mt-6 h-10 w-full")}>{c.pricing.choose}</Link>
                    </div>
                  );
                })}
              </div>
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-line bg-zinc-50 px-6 py-4">
                <div className="text-sm">
                  <span className="font-medium text-zinc-900">{c.pricing.plans.NETWORK}</span>
                  <span className="text-zinc-600"> · {c.pricing.studentsMore} · {c.pricing.custom}</span>
                </div>
                {tg ? (
                  <a href={`https://t.me/${tg}`} className="text-sm font-medium text-zinc-900 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-900">{c.pricing.contact}</a>
                ) : BRAND.contact.phone ? (
                  <a href={`tel:+${BRAND.contact.phone}`} className="text-sm font-medium text-zinc-900 underline decoration-zinc-300 underline-offset-4 hover:decoration-zinc-900">{formatPhone(BRAND.contact.phone)}</a>
                ) : null}
              </div>
            </div>
            <p className="mt-5 max-w-3xl text-sm text-zinc-600">{c.pricing.all}</p>
            <ul className="mt-3 space-y-1.5 text-sm text-zinc-600">
              {c.pricing.notes.map((n) => (
                <li key={n} className="flex items-start gap-2"><Check className="mt-0.5 h-4 w-4 shrink-0 text-zinc-900" aria-hidden />{n}</li>
              ))}
            </ul>
          </div>
        </section>

        {/* faq */}
        <section id="faq" className="scroll-mt-16 border-t border-line bg-canvas">
          <div className="mx-auto grid max-w-[1200px] gap-10 px-4 py-20 sm:px-6 lg:grid-cols-[1fr_1.6fr] lg:gap-16 lg:py-28">
            <h2 className="text-[32px] font-semibold leading-[1.1] tracking-[-0.03em] text-zinc-950 sm:text-[40px]">{c.faq.title}</h2>
            <div className="divide-y divide-zinc-200 border-y border-zinc-200">
              {c.faq.items.map(([q, a]) => (
                <details key={q} className="group">
                  <summary className="flex cursor-pointer list-none items-center justify-between gap-4 py-5 text-[15px] font-medium text-zinc-950 [&::-webkit-details-marker]:hidden">
                    {q}
                    <Plus className="h-4 w-4 shrink-0 text-zinc-500 transition-transform duration-200 group-open:rotate-45" aria-hidden />
                  </summary>
                  <p className="-mt-1 max-w-[60ch] pb-5 text-[14px] leading-relaxed text-zinc-600">{a}</p>
                </details>
              ))}
            </div>
          </div>
        </section>

        {/* close */}
        <section className="bg-zinc-950 text-white">
          <div className="mx-auto flex max-w-[1200px] flex-col items-start gap-8 px-4 py-20 sm:px-6 lg:flex-row lg:items-end lg:justify-between lg:py-24">
            <div>
              <h2 className="max-w-[18ch] text-[32px] font-semibold leading-[1.1] tracking-[-0.03em] sm:text-[40px]">{c.cta.title}</h2>
              <p className="mt-4 max-w-md text-[17px] leading-relaxed text-zinc-400">{c.cta.body}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Link href="/signup" className="inline-flex h-11 items-center gap-1.5 rounded-lg bg-white px-5 text-sm font-medium text-zinc-950 transition-colors hover:bg-zinc-200">{c.hero.start}<ChevronRight className="h-4 w-4" aria-hidden /></Link>
              {demo && <a href={demo} className="inline-flex h-11 items-center rounded-lg border border-zinc-700 px-5 text-sm font-medium text-white transition-colors hover:border-zinc-500 hover:bg-zinc-900">{c.hero.demo}</a>}
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-line">
        <div className="mx-auto grid max-w-[1200px] gap-8 px-4 py-12 text-sm sm:px-6 md:grid-cols-[1.4fr_1fr_1fr]">
          <div>
            <div className="flex items-center gap-2.5">
              <Mark className="h-7 w-7" />
              <Wordmark name={BRAND.name} className="font-semibold" />
            </div>
            <p className="mt-2 text-zinc-500">{BRAND.tagline[lang]}</p>
            {BRAND.legal.entity && <p className="mt-4 text-xs leading-relaxed text-zinc-500">{BRAND.legal.entity}{BRAND.legal.tin && ` · STIR ${BRAND.legal.tin}`}{BRAND.legal.address && <><br />{BRAND.legal.address}</>}</p>}
          </div>
          <ul className="space-y-2 text-zinc-600">
            <li><Link href="/legal/offer" className="hover:text-zinc-950">{c.footer.offer}</Link></li>
            <li><Link href="/legal/privacy" className="hover:text-zinc-950">{c.footer.privacy}</Link></li>
            <li><Link href="/login" className="hover:text-zinc-950">{c.footer.login}</Link></li>
          </ul>
          <div className="space-y-2 text-zinc-600">
            {(BRAND.contact.phone || tg || BRAND.contact.email) && <div className="font-medium text-zinc-900">{c.footer.contacts}</div>}
            {BRAND.contact.phone && <div><a href={`tel:+${BRAND.contact.phone}`} className="hover:text-zinc-950">{formatPhone(BRAND.contact.phone)}</a></div>}
            {tg && <div><a href={`https://t.me/${tg}`} className="hover:text-zinc-950">@{tg}</a></div>}
            {BRAND.contact.email && <div><a href={`mailto:${BRAND.contact.email}`} className="hover:text-zinc-950">{BRAND.contact.email}</a></div>}
            <div className="-ml-2.5 pt-1"><LanguageMenu current={lang} side="top" align="start" /></div>
          </div>
        </div>
        <div className="border-t border-line">
          <div className="mx-auto max-w-[1200px] px-4 py-5 text-xs text-zinc-500 sm:px-6">© {new Date().getFullYear()} {BRAND.legal.entity || BRAND.name}. {c.footer.rights}</div>
        </div>
      </footer>
    </div>
  );
}
