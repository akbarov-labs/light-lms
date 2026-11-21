"use client";

// Telegram Mini App for parents, students (and a door for teachers / owners). Launch data comes from the
// URL fragment Telegram adds (#tgWebAppData=…&tgWebAppThemeParams=…): no third-party script on the page.
import { useEffect, useMemo, useState } from "react";
import type { DictKey } from "@/lib/i18n";
import type { PortalData } from "@/lib/portal";
import { formatMoney } from "@/lib/money";
import { formatDate, monthLabel } from "@/lib/dates";
import { attendanceMark } from "@/lib/format";
import { formatPhone } from "@/lib/phone";

export type MiniLabels = Partial<Record<DictKey, string>>;
type Tab = "balance" | "schedule" | "attendance" | "docs";
type State = { kind: "loading" } | { kind: "outside" } | { kind: "error"; key: DictKey } | { kind: "ready"; locale: "uz" | "ru"; data: PortalData };

const STORE = "tg-init-data";
const DAYS = { uz: ["Du", "Se", "Ch", "Pa", "Ju", "Sh", "Ya"], ru: ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"] };

/** Telegram's documented web events (core.telegram.org/api/web-events), without loading telegram-web-app.js. */
export function postEvent(eventType: string, eventData: object = {}) {
  const w = window as unknown as { TelegramWebviewProxy?: { postEvent: (t: string, d: string) => void }; external?: { notify?: (s: string) => void } };
  try {
    if (w.TelegramWebviewProxy?.postEvent) w.TelegramWebviewProxy.postEvent(eventType, JSON.stringify(eventData));
    else if (typeof w.external?.notify === "function") w.external.notify(JSON.stringify({ eventType, eventData }));
    else if (window.parent !== window) window.parent.postMessage(JSON.stringify({ eventType, eventData }), "https://web.telegram.org");
  } catch {
    // outside Telegram there is nobody to tell
  }
}

function openLink(url: string) {
  const inTelegram = !!(window as unknown as { TelegramWebviewProxy?: unknown }).TelegramWebviewProxy || window.parent !== window;
  if (inTelegram) postEvent("web_app_open_link", { url });
  else window.open(url, "_blank", "noopener");
}

export function launchParams(): { initData: string | null; theme: Record<string, string> | null } {
  const hash = new URLSearchParams(window.location.hash.slice(1));
  let initData = hash.get("tgWebAppData");
  try {
    if (initData) sessionStorage.setItem(STORE, initData);
    else initData = sessionStorage.getItem(STORE);
  } catch {
    // storage blocked: the hash is enough for this load
  }
  let theme: Record<string, string> | null = null;
  try {
    theme = JSON.parse(hash.get("tgWebAppThemeParams") ?? "null");
  } catch {
    theme = null;
  }
  return { initData, theme };
}

export const THEME_VARS: Record<string, string> = { bg_color: "--tg-bg", text_color: "--tg-text", hint_color: "--tg-hint", link_color: "--tg-link", button_color: "--tg-button", button_text_color: "--tg-button-text", secondary_bg_color: "--tg-secondary-bg" };

export function MiniApp({ labels }: { labels: { uz: MiniLabels; ru: MiniLabels } }) {
  const [state, setState] = useState<State>({ kind: "loading" });
  const [tab, setTab] = useState<Tab>("balance");

  useEffect(() => {
    const { initData, theme } = launchParams();
    if (theme) for (const [k, v] of Object.entries(theme)) if (THEME_VARS[k] && /^#[0-9a-f]{3,8}$/i.test(v)) document.documentElement.style.setProperty(THEME_VARS[k], v);
    postEvent("web_app_ready");
    postEvent("web_app_expand");
    if (!initData) {
      setState({ kind: "outside" });
      return;
    }
    // a center's own bot opens /tg?b=<bot id>: the server checks the init data with that bot's token
    const b = new URLSearchParams(window.location.search).get("b");
    const url = b && /^\d{1,20}$/.test(b) ? `/api/tg/data?b=${b}` : "/api/tg/data";
    fetch(url, { method: "POST", body: initData, headers: { "content-type": "text/plain" } })
      .then(async (r) => {
        const j = (await r.json().catch(() => ({}))) as { locale?: "uz" | "ru"; data?: PortalData; error?: string };
        if (r.ok && j.data) setState({ kind: "ready", locale: j.locale === "ru" ? "ru" : "uz", data: j.data });
        else setState({ kind: "error", key: j.error === "expired" ? "tg.expired" : j.error === "bot_disabled" ? "tg.disabled" : "tg.error" });
      })
      .catch(() => setState({ kind: "error", key: "tg.error" }));
  }, []);

  const locale = state.kind === "ready" ? state.locale : typeof navigator !== "undefined" && navigator.language.startsWith("ru") ? "ru" : "uz";
  const t = useMemo(() => (k: DictKey) => labels[locale][k] ?? labels.uz[k] ?? k, [labels, locale]);
  const cur = locale === "ru" ? "сум" : "so'm";

  if (state.kind !== "ready") {
    const text = state.kind === "loading" ? t("tg.loading") : state.kind === "outside" ? t("tg.outside") : t(state.key);
    return <main className="tg-app flex min-h-screen items-center justify-center p-6 text-center text-sm" role={state.kind === "error" ? "alert" : "status"}>{text}</main>;
  }
  const d = state.data;
  if (!d.family && !d.teacher && !d.adminUrl) return <main className="tg-app flex min-h-screen items-center justify-center p-6 text-center text-sm">{t("tg.notLinked")}</main>;
  const day = (iso: string) => `${DAYS[locale][(new Date(`${iso}T00:00:00Z`).getUTCDay() + 6) % 7]} ${formatDate(iso).slice(0, 5)}`;
  const tabs: Tab[] = d.family ? ["balance", "schedule", "attendance", "docs"] : [];

  return (
    <div className="tg-app min-h-screen pb-20">
      <main className="mx-auto max-w-lg space-y-3 p-3">
        {d.teacher && (
          <section className="tg-card">
            <h2 className="tg-h">{t("tg.teacherToday")}</h2>
            {d.teacher.lessons.length === 0 ? <p className="tg-hint text-sm">{t("tg.noLessonsToday")}</p> : (
              <ul className="space-y-1 text-sm">
                {d.teacher.lessons.map((l, i) => <li key={i} className="flex justify-between gap-2"><span className="tnum">{l.start}–{l.end} · {l.group}</span><span className="tg-hint">{l.cancelled ? "✕" : l.marked ? t("tg.marked") : t("tg.notMarked")}</span></li>)}
              </ul>
            )}
            <button type="button" className="tg-button mt-3" onClick={() => openLink(d.teacher!.url)}>{t("tg.teacherOpen")}</button>
          </section>
        )}
        {d.adminUrl && <button type="button" className="tg-button tg-button-secondary" onClick={() => openLink(d.adminUrl!)}>{t("tg.adminOpen")}</button>}
        {/* timed tests open in the same Mini App (the init data is kept in sessionStorage); ?b= keeps a center bot's check */}
        {d.family && tab === "balance" && <a href={`/tg/quiz${window.location.search}`} className="tg-button tg-button-secondary text-center">{t("tg.quizzes")}</a>}

        {d.family && tab === "balance" && (
          <>
            {d.families.map((f) => (
              <section key={f.id} className="tg-card">
                <div className="tg-hint text-xs">{f.center}</div>
                <div className="mt-1 flex items-baseline justify-between gap-3">
                  <span className="text-sm">{f.balance < 0 ? t("tg.debt") : f.balance > 0 ? t("tg.prepaid") : t("tg.balance")}</span>
                  <span className={`tnum text-2xl font-semibold ${f.balance < 0 ? "text-red-600" : ""}`}>{formatMoney(Math.abs(f.balance), cur)}</span>
                </div>
                {f.students.map((s) => (
                  <div key={s.id} className="mt-3 border-t border-[var(--tg-sep)] pt-3">
                    <div className="font-medium">{s.name}</div>
                    {s.groups.map((g) => (
                      <div key={g.enrollmentId} className="mt-1 text-sm">
                        <div className="flex justify-between gap-2"><span>{g.name}</span>{g.debt > 0 && <span className="tnum font-medium text-red-600">−{formatMoney(g.debt, cur)}</span>}</div>
                        <div className="tg-hint tnum text-xs">{t("tg.charged")} {formatMoney(g.charged, cur)} · {t("tg.paid")} {formatMoney(g.paid, cur)}</div>
                        {g.next && <div className="tg-hint tnum text-xs">{t("tg.next")}: {formatDate(g.next.date)} — {formatMoney(g.next.amount, cur)}</div>}
                      </div>
                    ))}
                  </div>
                ))}
                {f.payUrl && <button type="button" className="tg-button mt-4" onClick={() => openLink(`${f.payUrl}${locale === "ru" ? "?lang=ru" : ""}`)}>{t("tg.pay")}{f.balance < 0 ? ` ${formatMoney(-f.balance, cur)}` : ""}</button>}
                {f.centerPhone && <a href={`tel:+${f.centerPhone}`} className="tg-link mt-3 block text-center text-sm">{t("tg.call")} {formatPhone(f.centerPhone)}</a>}
              </section>
            ))}
            {d.payments.length > 0 && (
              <section className="tg-card">
                <h2 className="tg-h">{t("tg.payments")}</h2>
                <ul className="space-y-1 text-sm">
                  {d.payments.map((p, i) => <li key={i} className={`flex justify-between gap-2 ${p.reversed ? "line-through opacity-60" : ""}`}><span className="tnum">{formatDate(p.date)}{p.method ? ` · ${t(`method.${p.method}` as DictKey)}` : ""}</span><span className="tnum">{formatMoney(p.amount, cur)}</span></li>)}
                </ul>
              </section>
            )}
          </>
        )}

        {d.family && tab === "schedule" && (
          <section className="tg-card">
            {d.schedule.length === 0 ? <p className="tg-hint text-sm">{t("tg.noSchedule")}</p> : (
              <ul className="divide-y divide-[var(--tg-sep)] text-sm">
                {d.schedule.map((l, i) => (
                  <li key={i} className="py-2">
                    <div className="flex justify-between gap-2"><span className="tnum font-medium">{l.date === d.today ? t("tg.today") : day(l.date)} · {l.start}–{l.end}</span><span className="tg-hint text-xs">{l.room ?? ""}</span></div>
                    <div className="tg-hint text-xs">{l.student} · {l.group} · {l.teacher}</div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {d.family && tab === "attendance" && (
          <section className="tg-card">
            {d.attendance.length === 0 ? <p className="tg-hint text-sm">{t("tg.noAttendance")}</p> : (
              <ul className="divide-y divide-[var(--tg-sep)] text-sm">
                {d.attendance.map((a, i) => (
                  <li key={i} className="flex items-center justify-between gap-2 py-2">
                    <span><span className="tnum">{day(a.date)}</span> <span className="tg-hint text-xs">· {a.student} · {a.group}</span></span>
                    <span className="tnum whitespace-nowrap" title={t(`attendance.${a.status}` as DictKey)}>{attendanceMark[a.status]} {t(`attendance.${a.status}` as DictKey)}{a.grade !== null ? ` · ${a.grade}` : ""}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {d.family && tab === "docs" && (
          <>
            {d.reportCards.length === 0 && d.certificates.length === 0 && <section className="tg-card"><p className="tg-hint text-sm">{t("tg.noDocs")}</p></section>}
            {d.reportCards.length > 0 && (
              <section className="tg-card">
                <h2 className="tg-h">{t("tg.reportCards")}</h2>
                <ul className="divide-y divide-[var(--tg-sep)] text-sm">
                  {d.reportCards.map((c, i) => (
                    <li key={i}>
                      <button type="button" className="flex w-full items-center justify-between gap-2 py-2 text-left" onClick={() => openLink(`${c.url}${locale === "ru" ? "?lang=ru" : ""}`)}>
                        <span>{monthLabel(c.month, locale)} · <span className="tg-hint">{c.student} · {c.group}</span></span>
                        <span className="tnum whitespace-nowrap text-xs">{c.attendancePct !== null ? `${c.attendancePct}%` : ""}{c.gradeAvg !== null ? ` · ${c.gradeAvg}` : ""}{c.rating ? ` · ${t(`rc.rating.${c.rating}` as DictKey)}` : ""} ›</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {d.certificates.length > 0 && (
              <section className="tg-card">
                <h2 className="tg-h">{t("tg.certificates")}</h2>
                <ul className="divide-y divide-[var(--tg-sep)] text-sm">
                  {d.certificates.map((c, i) => (
                    <li key={i}>
                      <button type="button" className={`flex w-full items-center justify-between gap-2 py-2 text-left ${c.revoked ? "line-through opacity-60" : ""}`} onClick={() => openLink(c.url)}>
                        <span>{c.title}{c.level ? ` · ${c.level}` : ""} <span className="tg-hint">· {c.student}</span></span>
                        <span className="tnum whitespace-nowrap text-xs">{c.number} ›</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </section>
            )}
          </>
        )}
      </main>
      {tabs.length > 0 && (
        <nav className="tg-tabs fixed inset-x-0 bottom-0 grid grid-cols-4 pb-[env(safe-area-inset-bottom)]" aria-label={t("tg.title")}>
          {tabs.map((k) => (
            <button key={k} type="button" aria-current={tab === k ? "page" : undefined} onClick={() => setTab(k)} className={`h-14 text-xs font-medium ${tab === k ? "tg-tab-active" : "tg-hint"}`}>{t(`tg.tab.${k}` as DictKey)}</button>
          ))}
        </nav>
      )}
    </div>
  );
}
