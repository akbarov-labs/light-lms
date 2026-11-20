// The question bank's keys (pure). The model only proposes keys: a printed answer and two independent solves
// are compared here, by code, and a person approves every question before a student sees it.
import { canonical, isCorrect } from "../homework/grade";

export type KeyCheckValue = "STATED" | "AGREED" | "CONFLICT" | "UNKNOWN";

export const LETTERS = ["A", "B", "C", "D", "E"] as const;

/**
 * A proposed answer in key form for a question with `optionCount` options (0 = open answer): a letter
 * within the options, or a number for an open question. Null when it does not fit.
 */
export function keyOf(raw: string | null | undefined, optionCount: number): string | null {
  if (!raw?.trim()) return null;
  const c = canonical(raw.trim());
  if (c === null) return null;
  const isLetter = /^[A-E]$/.test(c);
  if (optionCount > 0) return isLetter && LETTERS.indexOf(c as (typeof LETTERS)[number]) < optionCount ? c : null;
  return isLetter ? null : c;
}

const same = (a: string, b: string) => isCorrect(a, b);

export interface KeyDecision {
  /** "" = none: a person must choose */
  answer: string;
  keyCheck: KeyCheckValue;
}

/**
 * The key and how sure it is, from what the book prints (`stated`) and two independent solves. A printed
 * answer wins but is only STATED when both solves agree with it; otherwise CONFLICT, so a misprint or a
 * misread page reaches a person. Without a printed answer, two agreeing solves are AGREED; anything else has
 * no key until a person picks one.
 */
export function decideKey(stated: string | null, solves: (string | null)[], needsFigure: boolean): KeyDecision {
  const got = solves.filter((s): s is string => !!s);
  if (stated) {
    const agree = got.length === solves.length && got.length > 0 && got.every((s) => same(stated, s));
    return { answer: stated, keyCheck: agree && !needsFigure ? "STATED" : "CONFLICT" };
  }
  if (needsFigure || got.length === 0) return { answer: "", keyCheck: "UNKNOWN" };
  if (got.length === solves.length && got.every((s) => same(got[0], s))) return { answer: got[0], keyCheck: "AGREED" };
  return { answer: "", keyCheck: "CONFLICT" };
}

/** Topic codes in book order: "1.2" < "1.10", "1" < "1.1". */
export function compareCodes(a: string, b: string): number {
  const x = a.split(".").map(Number);
  const y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) {
    const d = (x[i] ?? -1) - (y[i] ?? -1);
    if (d) return d;
  }
  return 0;
}

/** "1.1.1" → ["1", "1.1", "1.1.1"]: the topic and the ones above it. */
export function codeChain(code: string): string[] {
  const parts = code.split(".");
  return parts.map((_, i) => parts.slice(0, i + 1).join("."));
}

export const isTopicCode = (s: string) => /^\d{1,3}(\.\d{1,3}){0,4}$/.test(s);

/** What a question needs before it can be approved: a key that fits its options. */
export function approvable(q: { answer: string; options: string[] }): boolean {
  return keyOf(q.answer, q.options.length) !== null || (q.options.length === 0 && /\|/.test(q.answer) && q.answer.split("|").every((a) => keyOf(a, 0) !== null));
}
