// Grading a timed test (pure): the bank question's key decides, by code (keyOf / isCorrect, the same rules as
// homework keys), never a model.
import { isCorrect } from "../homework/grade";
import { keyOf } from "../questions/keys";

export interface KeyedQuestion {
  options: string[];
  /** the bank key: "B", "-4", "2|-2" */
  answer: string;
}

/** What a typed or tapped answer is stored as: "" clears; a letter within the options, or a number for an open question; null = does not fit. */
export function cleanQuizAnswer(raw: string, optionCount: number): string | null {
  if (raw.trim() === "") return "";
  return keyOf(raw, optionCount);
}

export interface QuizGrade {
  correct: number;
  total: number;
  /** question numbers (from 1) answered wrong or left empty: what a student is shown, never the right answers */
  wrong: number[];
  blank: number[];
}

export function gradeAttempt(questions: readonly KeyedQuestion[], answers: readonly string[]): QuizGrade {
  let correct = 0;
  const wrong: number[] = [];
  const blank: number[] = [];
  questions.forEach((q, i) => {
    const given = answers[i] ?? "";
    if (given === "") blank.push(i + 1);
    if (q.answer && isCorrect(q.answer, given)) correct++;
    else wrong.push(i + 1);
  });
  return { correct, total: questions.length, wrong, blank };
}

export const percentOf = (correct: number, total: number) => (total > 0 ? Math.round((100 * correct) / total) : 0);

/** "Qoniqtiradi": at least passPercent of the questions right (the client: 70%). */
export const passed = (correct: number, total: number, passPercent: number) => total > 0 && correct * 100 >= passPercent * total;
