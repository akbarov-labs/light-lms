"use client";

// Mini App tests: a student's (or a parent's) topic tests, and the placement test for newcomers. One scrollable
// list of questions with letter buttons or a number field, a countdown from the server's deadline, "finish".
// Every call carries the signed init data; answers are saved one by one, so a closed app loses nothing.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { DictKey } from "@/lib/i18n";
import type { AttemptView, ChatQuiz } from "@/lib/services/quizzes";
import { launchParams, postEvent, THEME_VARS, type MiniLabels } from "../mini-app";

type Mode = "topic" | "placement";
type PlacementInfo = { minutes: number; count: number; topics: { id: string; code: string; title: string; depth: number }[]; known: string | null; running: string | null };
type Screen =
  | { kind: "loading" }
  | { kind: "outside" }
  | { kind: "error"; text: string }
  | { kind: "list"; linked: boolean; quizzes: ChatQuiz[] }
  | { kind: "placement"; center: string; info: PlacementInfo }
  | { kind: "placementClosed" }
  | { kind: "attempt"; view: AttemptView; receivedAt: number };

const LETTERS = ["A", "B", "C", "D", "E"];

export function QuizApp({ mode, labels }: { mode: Mode; labels: { uz: MiniLabels; ru: MiniLabels } }) {
  const [screen, setScreen] = useState<Screen>({ kind: "loading" });
  const [locale, setLocale] = useState<"uz" | "ru">("uz");
  const [busy, setBusy] = useState(false);
  const initData = useRef<string | null>(null);
  const t = useMemo(() => (k: DictKey, vars?: Record<string, string | number>) => {
    let s = labels[locale][k] ?? labels.uz[k] ?? k;
    if (vars) for (const [key, v] of Object.entries(vars)) s = s.replaceAll(`{${key}}`, String(v));
    return s;
  }, [labels, locale]);

  const call = useCallback(async (action: string, extra: Record<string, unknown> = {}): Promise<Record<string, unknown> & { error?: string; message?: string }> => {
    const b = new URLSearchParams(window.location.search).get("b");
    const url = b && /^\d{1,20}$/.test(b) ? `/api/tg/quiz?b=${b}` : "/api/tg/quiz";
    // never throws: a network failure is an error the screen shows
    const r = await fetch(url, { method: "POST", body: JSON.stringify({ action, initData: initData.current, ...extra }), headers: { "content-type": "application/json" } }).catch(() => null);
    if (!r) return { error: "network" };
    const j =(await r.json().catch(() => ({}))) as Record<string, unknown> & { error?: string; message?: string; locale?: string };
    if (j.locale === "ru" || j.locale === "uz") setLocale(j.locale);
    if (r.status === 401) return { error: j.error === "expired" ? "expired" : "auth" };
    return r.ok ? j : { ...j, error: j.error ?? "server" };
  }, []);

  const fail = useCallback((j: { error?: string; message?: string }) => setScreen({ kind: "error", text: j.message ?? (j.error === "expired" ? t("quiz.tg.expired") : t("quiz.tg.error")) }), [t]);
  const showAttempt = useCallback((view: AttemptView) => setScreen({ kind: "attempt", view, receivedAt: Date.now() }), []);

  const loadList = useCallback(async () => {
    const j = await call("list");
    if (j.error) return fail(j);
    const quizzes = (j.quizzes as ChatQuiz[]) ?? [];
    // opened from a test's message: put that test first
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) quizzes.sort((a, b) => Number(b.quizId === q) - Number(a.quizId === q));
    setScreen({ kind: "list", linked: !!j.linked, quizzes });
  }, [call, fail]);

  const loadPlacement = useCallback(async () => {
    const c = new URLSearchParams(window.location.search).get("c");
    const j = await call("placementInfo", { c });
    if (j.error) return fail(j);
    if (j.closed) return setScreen({ kind: "placementClosed" });
    const info = j.info as PlacementInfo;
    if (info.running) {
      const v = await call("view", { attemptId: info.running });
      if (!v.error) return showAttempt(v.attempt as AttemptView);
    }
    setScreen({ kind: "placement", center: (j.center as { name: string }).name, info });
  }, [call, fail, showAttempt]);

  useEffect(() => {
    const { initData: data, theme } = launchParams();
    if (theme) for (const [k, v] of Object.entries(theme)) if (THEME_VARS[k] && /^#[0-9a-f]{3,8}$/i.test(v)) document.documentElement.style.setProperty(THEME_VARS[k], v);
    postEvent("web_app_ready");
    postEvent("web_app_expand");
    if (typeof navigator !== "undefined" && navigator.language.startsWith("ru")) setLocale("ru");
    if (!data) return setScreen({ kind: "outside" });
    initData.current = data;
    void (mode === "placement" ? loadPlacement() : loadList()).catch(() => setScreen({ kind: "error", text: "" }));
  }, [mode, loadList, loadPlacement]);

  const open = async (quizId: string, studentId: string) => {
    setBusy(true);
    const j = await call("start", { quizId, studentId });
    setBusy(false);
    if (j.error) return fail(j);
    showAttempt((j as { attempt: AttemptView }).attempt);
  };

  if (screen.kind === "loading" || screen.kind === "outside" || screen.kind === "error" || screen.kind === "placementClosed") {
    const text = screen.kind === "loading" ? t("quiz.tg.loading") : screen.kind === "outside" ? t("quiz.tg.outside") : screen.kind === "placementClosed" ? t("quiz.tg.placementClosed") : screen.text || t("quiz.tg.error");
    return <main className="tg-app flex min-h-screen items-center justify-center p-6 text-center text-sm" role={screen.kind === "error" ? "alert" : "status"}>{text}</main>;
  }

  if (screen.kind === "list") {
    if (!screen.linked) return <main className="tg-app flex min-h-screen items-center justify-center p-6 text-center text-sm">{t("quiz.tg.notLinked")}</main>;
    return (
      <div className="tg-app min-h-screen">
        <main className="mx-auto max-w-lg space-y-3 p-3">
          <h1 className="px-1 text-lg font-semibold">{t("quiz.tg.title")}</h1>
          {screen.quizzes.length === 0 && <section className="tg-card"><p className="tg-hint text-sm">{t("quiz.tg.none")}</p></section>}
          {screen.quizzes.map((q) => {
            const done = q.attempt?.state === "submitted" || q.attempt?.state === "expired";
            const closed = q.status === "CLOSED";
            return (
              <section key={`${q.quizId}:${q.studentId}`} className="tg-card">
                <div className="tg-hint text-xs">{q.group} · {q.studentName}</div>
                <div className="mt-1 font-medium">{q.title}</div>
                <div className="tg-hint tnum mt-1 text-xs">{t("quiz.tg.meta", { n: q.questions, m: q.minutes })}{closed ? ` · ${t("quiz.tg.closedTest")}` : ""}</div>
                {!q.attempt && !closed && <p className="tg-hint mt-2 text-xs">{t("quiz.tg.startHint")}</p>}
                {done && q.attempt?.correct !== null && q.attempt && <p className="tnum mt-2 text-sm font-semibold">{t("quiz.tg.score", { c: q.attempt.correct ?? 0, t: q.attempt.total, p: q.attempt.total ? Math.round(((q.attempt.correct ?? 0) * 100) / q.attempt.total) : 0 })}</p>}
                {(q.attempt || !closed) && (
                  <button type="button" disabled={busy} className={`tg-button mt-3 ${done ? "tg-button-secondary" : ""}`} onClick={() => open(q.quizId, q.studentId)}>
                    {done ? t("quiz.tg.result") : q.attempt ? t("quiz.tg.continue") : t("quiz.tg.start")}
                  </button>
                )}
              </section>
            );
          })}
        </main>
      </div>
    );
  }

  if (screen.kind === "placement") return <PlacementStart center={screen.center} info={screen.info} t={t} call={call} onAttempt={showAttempt} />;

  return <Attempt key={screen.view.id} view={screen.view} receivedAt={screen.receivedAt} t={t} call={call} onView={showAttempt} onBack={mode === "topic" ? () => void loadList() : null} />;
}

type T = (k: DictKey, vars?: Record<string, string | number>) => string;
type Call = (action: string, extra?: Record<string, unknown>) => Promise<Record<string, unknown> & { error?: string; message?: string }>;

function PlacementStart({ center, info, t, call, onAttempt }: { center: string; info: PlacementInfo; t: T; call: Call; onAttempt: (v: AttemptView) => void }) {
  const [topicId, setTopicId] = useState("");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [phone, setPhone] = useState("+998 ");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const start = async () => {
    setBusy(true);
    setError(null);
    const j = await call("placementStart", { c: new URLSearchParams(window.location.search).get("c"), topicId, firstName, lastName, phone });
    setBusy(false);
    if (j.error) return setError(j.message ?? t("quiz.tg.error"));
    onAttempt((j as { attempt: AttemptView }).attempt);
  };
  const ready = !!topicId && (!!info.known || (firstName.trim() && lastName.trim() && phone.replace(/\D/g, "").length >= 9));
  return (
    <div className="tg-app min-h-screen">
      <main className="mx-auto max-w-lg space-y-3 p-3">
        <div className="px-1">
          <div className="tg-hint text-xs">{center}</div>
          <h1 className="text-lg font-semibold">{t("quiz.tg.placementTitle")}</h1>
          <p className="tg-hint tnum text-xs">{t("quiz.tg.meta", { n: info.count, m: info.minutes })}</p>
        </div>
        <section className="tg-card space-y-2">
          <label htmlFor="pt-topic" className="tg-h block">{t("quiz.tg.pickTopic")}</label>
          <select id="pt-topic" className="tg-input" value={topicId} onChange={(e) => setTopicId(e.target.value)}>
            <option value="">—</option>
            {info.topics.map((x) => <option key={x.id} value={x.id}>{x.depth > 0 ? "   " : ""}{x.code}. {x.title}</option>)}
          </select>
          <p className="tg-hint text-xs">{t("quiz.tg.pickTopicHint")}</p>
        </section>
        <section className="tg-card space-y-2">
          <h2 className="tg-h">{t("quiz.tg.who")}</h2>
          {info.known ? (
            <p className="text-sm font-medium">{info.known}</p>
          ) : (
            <>
              <input className="tg-input" aria-label={t("quiz.tg.firstName")} placeholder={t("quiz.tg.firstName")} value={firstName} onChange={(e) => setFirstName(e.target.value)} maxLength={60} autoComplete="given-name" />
              <input className="tg-input" aria-label={t("quiz.tg.lastName")} placeholder={t("quiz.tg.lastName")} value={lastName} onChange={(e) => setLastName(e.target.value)} maxLength={60} autoComplete="family-name" />
              <input className="tg-input tnum" aria-label={t("quiz.tg.phone")} placeholder={t("quiz.tg.phone")} value={phone} onChange={(e) => setPhone(e.target.value)} maxLength={30} inputMode="tel" autoComplete="tel" />
            </>
          )}
        </section>
        <p className="tg-hint px-1 text-xs">{t("quiz.tg.startHint")}</p>
        {error && <p role="alert" className="px-1 text-sm text-red-600">{error}</p>}
        <button type="button" className="tg-button" disabled={!ready || busy} onClick={start}>{t("quiz.tg.start")}</button>
      </main>
    </div>
  );
}

function Attempt({ view, receivedAt, t, call, onView, onBack }: { view: AttemptView; receivedAt: number; t: T; call: Call; onView: (v: AttemptView) => void; onBack: (() => void) | null }) {
  const [answers, setAnswers] = useState<string[]>(view.answers);
  const [drafts, setDrafts] = useState<Record<number, string>>({});
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [left, setLeft] = useState(view.secondsLeft);
  const [busy, setBusy] = useState(false);
  const open = view.state === "open";

  const refresh = useCallback(async () => {
    const j = await call("view", { attemptId: view.id });
    if (!j.error) onView(j.attempt as AttemptView);
  }, [call, onView, view.id]);

  // the countdown runs on this phone's clock from the server's "seconds left" at load time
  useEffect(() => {
    if (!open) return;
    const tick = () => {
      const s = Math.max(0, view.secondsLeft - Math.floor((Date.now() - receivedAt) / 1000));
      setLeft(s);
      if (s === 0) void refresh();
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [open, view.secondsLeft, receivedAt, refresh]);

  const answer = async (q: number, value: string) => {
    const before = answers[q];
    setAnswers((a) => a.map((x, i) => (i === q ? value : x)));
    setErrors((e) => ({ ...e, [q]: "" }));
    const j = await call("answer", { attemptId: view.id, q, value });
    if (j.ok) return;
    setAnswers((a) => a.map((x, i) => (i === q ? before : x)));
    if (j.reason === "closed") return void refresh();
    setErrors((e) => ({ ...e, [q]: j.reason === "invalid" ? t("quiz.tg.invalid") : (j.message as string) ?? t("quiz.tg.saveFailed") }));
  };

  const finish = async () => {
    const blank = answers.filter((a) => a === "").length;
    if (!window.confirm(blank ? t("quiz.tg.finishBlank", { n: blank }) : t("quiz.tg.finishConfirm"))) return;
    setBusy(true);
    const j = await call("submit", { attemptId: view.id });
    setBusy(false);
    if (!j.error) onView(j.attempt as AttemptView);
  };

  const answered = answers.filter((a) => a !== "").length;
  const clock = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`;

  if (!open) {
    const r = view.result;
    return (
      <div className="tg-app min-h-screen">
        <main className="mx-auto max-w-lg space-y-3 p-3">
          <section className="tg-card">
            <div className="tg-hint text-xs">{view.name}</div>
            <h1 className="mt-1 font-semibold">{view.title}</h1>
            {view.state !== "submitted" && <p className="tg-hint mt-2 text-sm">{t("quiz.tg.timeUp")}</p>}
            {r && <p className="tnum mt-3 text-2xl font-semibold">{t("quiz.tg.score", { c: r.correct, t: r.total, p: r.percent })}</p>}
            {r?.wrong && <p className="mt-2 text-sm">{r.wrong.length ? t("quiz.tg.wrong", { list: r.wrong.join(", ") }) : t("quiz.tg.allRight")}</p>}
            {view.kind === "PLACEMENT" && <p className="tg-hint mt-3 text-sm">{t("quiz.tg.placementDone")}</p>}
          </section>
          {onBack && <button type="button" className="tg-button tg-button-secondary" onClick={onBack}>{t("quiz.tg.back")}</button>}
        </main>
      </div>
    );
  }

  return (
    <div className="tg-app min-h-screen pb-24">
      <header className="tg-timer sticky top-0 z-10">
        <div className="mx-auto flex max-w-lg items-center justify-between gap-3 px-4 py-2">
          <div className="min-w-0">
            <div className="truncate text-sm font-medium">{view.title}</div>
            <div className="tg-hint tnum text-xs">{t("quiz.tg.answered", { a: answered, n: view.questions.length })}</div>
          </div>
          <div className={`tnum text-xl font-semibold ${left <= 60 ? "text-red-600" : ""}`} role="timer" aria-label={t("quiz.tg.left")}>{clock}</div>
        </div>
      </header>
      <main className="mx-auto max-w-lg space-y-3 p-3">
        {view.questions.map((q, i) => (
          <section key={q.n} className="tg-card">
            <p className="whitespace-pre-wrap text-[15px] leading-relaxed"><span className="tnum font-semibold">{q.n}.</span> {q.text}</p>
            {q.options.length > 0 ? (
              <div className="mt-3 grid gap-2">
                {q.options.map((o, k) => (
                  <button key={k} type="button" className="tg-choice" aria-pressed={answers[i] === LETTERS[k]} onClick={() => answer(i, answers[i] === LETTERS[k] ? "" : LETTERS[k])}>
                    <span className="tnum font-semibold">{LETTERS[k]})</span> <span>{o}</span>
                  </button>
                ))}
              </div>
            ) : (
              <form
                className="mt-3 flex gap-2"
                onSubmit={(e) => {
                  e.preventDefault();
                  void answer(i, (drafts[i] ?? answers[i]).trim());
                }}
              >
                <input
                  className="tg-input tnum"
                  inputMode="text"
                  aria-label={t("quiz.tg.number")}
                  placeholder={t("quiz.tg.number")}
                  value={drafts[i] ?? answers[i]}
                  maxLength={40}
                  onChange={(e) => setDrafts((d) => ({ ...d, [i]: e.target.value }))}
                  onBlur={() => drafts[i] !== undefined && drafts[i].trim() !== answers[i] && void answer(i, drafts[i].trim())}
                />
                <button type="submit" className="tg-button w-auto px-4" style={{ width: "auto" }}>OK</button>
              </form>
            )}
            {errors[i] && <p role="alert" className="mt-2 text-xs text-red-600">{errors[i]}</p>}
          </section>
        ))}
      </main>
      <div className="tg-tabs fixed inset-x-0 bottom-0 p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
        <div className="mx-auto max-w-lg">
          <button type="button" className="tg-button" disabled={busy} onClick={finish}>{t("quiz.tg.finish")}</button>
        </div>
      </div>
    </div>
  );
}
