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
