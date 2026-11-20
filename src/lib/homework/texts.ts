// Homework texts shared by the web service (the notice it queues) and the bot (the menu button it names).
import { esc } from "../messages";
import type { Locale } from "../i18n";

export const HOMEWORK_BTN = { uz: "📝 Uy vazifasi", ru: "📝 Домашнее задание" } as const;

/** The notice a student (or a parent, who also sees the child's name) gets when homework is set. */
export function homeworkNotice(
  l: Locale,
  h: { group: string; questions: number; note: string | null; due: string | null; student: string | null },
): string {
  const lines =
    l === "ru"
      ? [
          `📝 <b>Новое домашнее задание</b> · ${esc(h.group)}`,
          h.student ? `👤 ${esc(h.student)}` : null,
          h.note ? esc(h.note) : null,
          `Вопросов: ${h.questions}. ${h.due ? `Ответы принимаются до ${h.due}.` : "Ответы принимаются до следующего урока."}`,
          `Ответить: кнопка «${HOMEWORK_BTN.ru}» в меню бота.`,
        ]
      : [
          `📝 <b>Yangi uy vazifasi</b> · ${esc(h.group)}`,
          h.student ? `👤 ${esc(h.student)}` : null,
          h.note ? esc(h.note) : null,
          `${h.questions} ta savol. ${h.due ? `Javoblar ${h.due} gacha qabul qilinadi.` : "Javoblar keyingi darsgacha qabul qilinadi."}`,
          `Javob berish: botdagi «${HOMEWORK_BTN.uz}» tugmasi.`,
        ];
  return lines.filter((x) => x !== null).join("\n");
}

/** A student or parent: answers are due soon and nothing is in yet. */
export function homeworkReminder(l: Locale, h: { group: string; student: string; due: string; questions: number }): string {
  return l === "ru"
    ? [`⏰ <b>Домашнее задание</b> · ${esc(h.group)}`, `👤 ${esc(h.student)}`, `Ответов ещё нет. Срок: ${h.due} (${h.questions} вопросов).`, `Ответить: кнопка «${HOMEWORK_BTN.ru}» в меню бота.`].join("\n")
    : [`⏰ <b>Uy vazifasi</b> · ${esc(h.group)}`, `👤 ${esc(h.student)}`, `Hali javob yuborilmagan. Muddat: ${h.due} (${h.questions} ta savol).`, `Javob berish: botdagi «${HOMEWORK_BTN.uz}» tugmasi.`].join("\n");
}

/** The teacher at the deadline: who answered, the average, who did not. */
export function homeworkDueSummary(l: Locale, h: { group: string; lessonDate: string; answered: number; total: number; average: number | null; missing: string[]; url: string }): string {
  const missing = h.missing.length ? h.missing.map(esc).join(", ") : null;
  return l === "ru"
    ? [
        `📝 <b>${esc(h.group)}</b> · задание от ${h.lessonDate}: срок истёк`,
        `Ответили: ${h.answered}/${h.total}${h.average !== null ? ` · в среднем ${h.average}% верно (первая попытка)` : ""}`,
        missing ? `Не ответили: ${missing}` : null,
        h.url,
      ].filter(Boolean).join("\n")
    : [
        `📝 <b>${esc(h.group)}</b> · ${h.lessonDate} vazifasi: muddat tugadi`,
        `Javob berdi: ${h.answered}/${h.total}${h.average !== null ? ` · o'rtacha ${h.average}% to'g'ri (birinchi urinish)` : ""}`,
        missing ? `Javob bermadi: ${missing}` : null,
        h.url,
      ].filter(Boolean).join("\n");
}

/** The teacher: a student answered after the deadline (checked separately, the client asked to be told). */
export function homeworkLateNotice(l: Locale, h: { group: string; lessonDate: string; student: string; correct: number; total: number; url: string }): string {
  return l === "ru"
    ? [`⏰ <b>Сдано с опозданием</b> · ${esc(h.group)} (задание от ${h.lessonDate})`, `👤 ${esc(h.student)}: ${h.correct}/${h.total} верно`, h.url].join("\n")
    : [`⏰ <b>Kech topshirildi</b> · ${esc(h.group)} (${h.lessonDate} vazifasi)`, `👤 ${esc(h.student)}: ${h.correct}/${h.total} to'g'ri`, h.url].join("\n");
}
