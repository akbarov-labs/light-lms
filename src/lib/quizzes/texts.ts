// Quiz messages queued by the service (Telegram HTML). Pure.
import { esc } from "../messages";
import type { Locale } from "../i18n";

export const QUIZ_BTN = { uz: "📝 Testni boshlash", ru: "📝 Начать тест" } as const;
export const PLACEMENT_BTN = { uz: "🧭 Kirish testini boshlash", ru: "🧭 Начать вступительный тест" } as const;

/** A student (or a parent, who also sees the child's name) when a test is published for the group. */
export function quizNotice(l: Locale, q: { title: string; group: string; questions: number; minutes: number; student: string | null }): string {
  const lines =
    l === "ru"
      ? [`📝 <b>Тест</b> · ${esc(q.group)}`, q.student ? `👤 ${esc(q.student)}` : null, esc(q.title), `Вопросов: ${q.questions}, время: ${q.minutes} мин. Время идёт с момента, когда тест открыт.`, `Открыть: кнопка «${QUIZ_BTN.ru}».`]
      : [`📝 <b>Test</b> · ${esc(q.group)}`, q.student ? `👤 ${esc(q.student)}` : null, esc(q.title), `${q.questions} ta savol, vaqt: ${q.minutes} daqiqa. Vaqt test ochilgan paytdan boshlab hisoblanadi.`, `Ochish: «${QUIZ_BTN.uz}» tugmasi.`];
  return lines.filter((x) => x !== null).join("\n");
}

/** The owners and the group's teacher, as soon as a student finishes: the score first goes to them. */
export function quizResultStaff(
  l: Locale,
  r: { student: string; title: string; group: string; correct: number; total: number; percent: number; minutes: number | null; auto: boolean; url: string },
): string {
  const time = r.minutes === null ? "" : l === "ru" ? ` · ${r.minutes} мин` : ` · ${r.minutes} daq`;
  const auto = r.auto ? (l === "ru" ? " (время вышло)" : " (vaqt tugadi)") : "";
  return l === "ru"
    ? [`📝 <b>${esc(r.student)}</b> · ${esc(r.group)}`, `${esc(r.title)}: <b>${r.correct}/${r.total}</b> (${r.percent}%)${time}${auto}`, `Результаты: ${r.url}`].join("\n")
    : [`📝 <b>${esc(r.student)}</b> · ${esc(r.group)}`, `${esc(r.title)}: <b>${r.correct}/${r.total}</b> (${r.percent}%)${time}${auto}`, `Natijalar: ${r.url}`].join("\n");
}

/** A parent, only when the owner sends the results (their permission). */
export function quizResultParent(l: Locale, r: { student: string; title: string; group: string; correct: number; total: number; percent: number }): string {
  return l === "ru"
    ? [`📝 <b>Результат теста</b> · ${esc(r.group)}`, `👤 ${esc(r.student)}`, `${esc(r.title)}: <b>${r.correct}/${r.total}</b> (${r.percent}%)`].join("\n")
    : [`📝 <b>Test natijasi</b> · ${esc(r.group)}`, `👤 ${esc(r.student)}`, `${esc(r.title)}: <b>${r.correct}/${r.total}</b> (${r.percent}%)`].join("\n");
}

/** The owners: a placement test was finished. The suggestion is only a suggestion: they decide. */
export function placementResultStaff(
  l: Locale,
  r: { name: string; phone: string | null; topic: string; correct: number; total: number; percent: number; passed: boolean; suggestion: string | null; auto: boolean; url: string },
): string {
  const verdict = r.passed ? (l === "ru" ? "✅ удовлетворительно" : "✅ qoniqtiradi") : l === "ru" ? "⚠️ ниже порога" : "⚠️ qoniqtirmaydi";
  const auto = r.auto ? (l === "ru" ? " (время вышло)" : " (vaqt tugadi)") : "";
  return (
    l === "ru"
      ? [`🧭 <b>Вступительный тест</b>`, `👤 ${esc(r.name)}${r.phone ? ` · +${r.phone}` : ""}`, `Изучил до: ${esc(r.topic)}`, `<b>${r.correct}/${r.total}</b> (${r.percent}%) — ${verdict}${auto}`, r.suggestion ? `Предложение: ${esc(r.suggestion)}` : null, `Записать в группу: ${r.url}`]
      : [`🧭 <b>Kirish testi</b>`, `👤 ${esc(r.name)}${r.phone ? ` · +${r.phone}` : ""}`, `O'qigan mavzusi: ${esc(r.topic)}`, `<b>${r.correct}/${r.total}</b> (${r.percent}%) — ${verdict}${auto}`, r.suggestion ? `Taklif: ${esc(r.suggestion)}` : null, `Guruhga yozish: ${r.url}`]
  )
    .filter((x) => x !== null)
    .join("\n");
}

/** The bot's answer to a placement start link: the button opens the test in the Mini App. */
export function placementStartText(l: Locale, center: string): string {
  return l === "ru"
    ? `🧭 <b>${esc(center)}</b>: вступительный тест.\nВыберите тему, до которой вы дошли, и ответьте на вопросы. Время ограничено. Результат увидит центр и свяжется с вами.`
    : `🧭 <b>${esc(center)}</b>: kirish testi.\nQaysi mavzugacha o'qiganingizni tanlang va savollarga javob bering. Vaqt cheklangan. Natijani markaz ko'radi va siz bilan bog'lanadi.`;
}
