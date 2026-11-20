// Code guards around the math tutor's model call (src/lib/tutor/service.ts). Pure functions, unit-tested.
//
// The prompt tells the model never to give homework or test answers; these make it hold in code too:
// - looksLikeSheet: a pasted list of numbered problems is refused before any model call;
// - leakedQuestion: a reply that states an open homework's key for a numbered question is replaced.
//
// The leak check is a cheap, deterministic heuristic, not a proof. It knows the keys, never the problem
// texts, so it can only catch a key tied to its question number: "5) -4", "5-misol javobi: B", or a final
// answer ("javob: -4", "x = -4", "… = -4" ending a line) when the student's message or the same line of the
// reply names question 5. A reply that solves the student's own problem without its number is left to the
// prompt (the model never sees the keys, so it cannot aim at them either).
import { isCorrect } from "@/lib/homework/grade";

/** A number as a key item may be: integer, decimal with "." or ",", fraction. */
const NUM = String.raw`[+-]?\d+(?:[.,]\d+)?(?:\s*\/\s*\d+)?`;
/** A number ends here: not followed by more of a number, a variable or a word ("2x", "4y", "5ta"). */
const END = String.raw`(?![\d\p{L}]|[.,/]\d)`;
/** Choice letters, Latin and the Cyrillic look-alikes a phone keyboard gives (grade.ts reads both). */
const LETTER = "[A-EАВСДЕ]";
/** A letter stands alone: punctuation, a line end or the next "n)" follows ("Задача 5: В ней" is a word). */
const LETTER_END = String.raw`(?=\s*(?:[).,;:!?]|$|\d{1,3}\s*[).:\-–—]))`;
/** One answer value, captured: a number, or a letter standing alone. */
const VALUE = `(${NUM}${END}|${LETTER}${LETTER_END})`;

/** Words that name a question by number, in Uzbek (Latin and Cyrillic), Karakalpak, Russian, English. */
const QWORDS = String.raw`misol\p{L}*|masala\p{L}*|savol\p{L}*|soraw\p{L}*|topshiriq\p{L}*|mashq\p{L}*|test\p{L}*|мисол\p{L}*|масала\p{L}*|савол\p{L}*|топшириқ\p{L}*|машқ\p{L}*|вопрос\p{L}*|задач\p{L}*|задани\p{L}*|пример\p{L}*|номер\p{L}*|question|problem|task|exercise`;

/** "5-misol", "5 masala", "№5", "#5", "задача 5", "savol 5": a question named by number. */
const STRONG = [
  new RegExp(String.raw`(?<![\d\p{L}])(\d{1,3})\s*[-–—]?\s*(?:${QWORDS})`, "giu"),
  new RegExp(String.raw`(?:#|\bno\.?)\s*(\d{1,3})(?!\d)`, "giu"),
  new RegExp(String.raw`(?<![\p{L}])(?:${QWORDS})\s*(?:№|#|no\.?)?\s*(\d{1,3})(?![\d\p{L}])`, "giu"),
];

/** Answer words a final answer follows: "javob: -4", "ответ: B", "J: 3/4", "answer is 7". */
const ANSWER_WORD = String.raw`(?:to'?g'?ri\s+)?(?:javob\p{L}*|жавоб\p{L}*|juwap\p{L}*|ответ\p{L}*|answer(?:\s+is)?|j\.?)`;
/** Between a question's name and its value: ":", "—", "=", an answer word. */
const SEP = String.raw`\s*(?:[:\-–—=]\s*)?(?:${ANSWER_WORD}\s*[:\-–—=]?\s*)?`;

export interface FoundValue {
  value: string;
  /** index in plain(text) */
  at: number;
}

/** Strip HTML tags, entities and emphasis marks, fold Unicode forms and dashes, so the patterns see plain text. */
export function plain(text: string): string {
  return text
    .replace(/<[^>]{1,40}>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/[*_`]/g, "")
    .normalize("NFKC")
    .replace(/[−‐-―]/g, "-");
}

/** Question numbers a text names (the word / № forms; with `lineStarts` also a line starting "5)" or "5."). */
export function namedQuestions(text: string, lineStarts = false): Set<number> {
  const t = plain(text);
  const out = new Set<number>();
  for (const re of STRONG) for (const m of t.matchAll(re)) out.add(Number(m[1]));
  if (lineStarts) for (const m of t.matchAll(/^\s*(\d{1,3})\s*[).]/gmu)) out.add(Number(m[1]));
  out.delete(0);
  return out;
}

/** Values stated as a final answer: after an answer word, "x = v", "= v" ending a line, "B variant". */
export function finalValues(text: string): FoundValue[] {
  const t = plain(text);
  const out: FoundValue[] = [];
  const add = (re: RegExp) => {
    for (const m of t.matchAll(re)) out.push({ value: m[1].replace(/\s+/g, ""), at: m.index ?? 0 });
  };
  add(new RegExp(String.raw`${ANSWER_WORD}\s*[:\-–—=]?\s*(?:[a-zа-я]\s*=\s*)?\(?${VALUE}`, "gimu"));
  add(new RegExp(String.raw`(?<![\p{L}\d])[a-z]\s*=\s*(${NUM})${END}`, "giu"));
  add(new RegExp(String.raw`=\s*(${NUM})\s*[.!]?\s*$`, "gmu"));
  add(new RegExp(String.raw`(?<![\p{L}])(${LETTER})\)?\s*(?:variant|вариант)`, "gu"));
  add(new RegExp(String.raw`(?:variant|вариант)\p{L}*\s*[:\-–—]?\s*(${LETTER})(?![\p{L}])`, "giu"));
  return out;
}

interface Pair {
  n: number;
  value: string;
  /** named with a word or № ("5-misol: -4"), not only "5) -4" */
  strong: boolean;
  line: number;
}

/** "5) -4", "5. B", "5 - C", "5-misol: 3/4", "№5 — B", "задача 5: ответ 7": a question number with a value right after it. */
function pairs(text: string): Pair[] {
  const out: Pair[] = [];
  plain(text)
    .split("\n")
    .forEach((line, i) => {
      const bare = new RegExp(String.raw`(?<![\d\p{L}.,(])(\d{1,3})\s*(?:[):\-–—]|\.(?=\s))\s*(?:${ANSWER_WORD}\s*[:\-–—=]?\s*)?${VALUE}`, "giu");
      for (const m of line.matchAll(bare)) out.push({ n: Number(m[1]), value: m[2].replace(/\s+/g, ""), strong: false, line: i });
      const strong = [
        new RegExp(String.raw`(?<![\d\p{L}])(\d{1,3})\s*[-–—]?\s*(?:${QWORDS})${SEP}${VALUE}`, "giu"),
        new RegExp(String.raw`(?:#|\bno\.?)\s*(\d{1,3})${SEP}${VALUE}`, "giu"),
        new RegExp(String.raw`(?<![\p{L}])(?:${QWORDS})\s*(?:№|#)?\s*(\d{1,3})${SEP}${VALUE}`, "giu"),
      ];
      for (const re of strong) for (const m of line.matchAll(re)) out.push({ n: Number(m[1]), value: m[2].replace(/\s+/g, ""), strong: true, line: i });
    });
  return out;
}

/** Does `value` match question n's key in one of the open keys? */
function matchesKey(keys: string[][], n: number, value: string): boolean {
  if (n < 1) return false;
  // the patterns are case-insensitive for the words; a lower-case letter is a word ("в", "a"), not a choice
  if (/^\p{Ll}$/u.test(value)) return false;
  return keys.some((k) => n <= k.length && isCorrect(k[n - 1], value));
}

/** A line made only of "n) value" pairs: an answer list, not a sentence with a numbered step. */
function answerListLine(line: string): boolean {
  return line.replace(new RegExp(String.raw`(\d{1,3})\s*(?:[):\-–—]|\.(?=\s))\s*${VALUE}`, "gu"), "").replace(/[\s,;|.]+/g, "").length === 0;
}

/**
 * The question number whose key the tutor's reply gives away, or null. `keys`: the answer keys of the
 * student's open homework (Homework.answers, one array per homework). `studentText`: the message the reply
 * answers ("5-misolni tushuntiring" names question 5).
 */
export function leakedQuestion(reply: string, keys: string[][], studentText = ""): number | null {
  if (keys.every((k) => k.length === 0)) return null;
  const found = pairs(reply);
  // 1. a question named with a word or № and its key right after it
  for (const p of found) if (p.strong && matchesKey(keys, p.n, p.value)) return p.n;
  // 2. bare "n) value" pairs: two different questions' keys, or one in a line that is only an answer list
  const bare = found.filter((p) => !p.strong && matchesKey(keys, p.n, p.value));
  if (new Set(bare.map((p) => p.n)).size >= 2) return bare[0].n;
  const text = plain(reply);
  const lines = text.split("\n");
  for (const p of bare) if (answerListLine(lines[p.line])) return p.n;
  // 3. a final answer equal to the key of a question named in the same line of the reply, or in the student's message
  const asked = namedQuestions(studentText, true);
  for (const f of finalValues(reply)) {
    const start = text.lastIndexOf("\n", f.at) + 1;
    const end = text.indexOf("\n", f.at);
    const near = new Set([...namedQuestions(text.slice(start, end === -1 ? undefined : end)), ...asked]);
    for (const n of near) if (matchesKey(keys, n, f.value)) return n;
  }
  return null;
}

/**
 * A pasted homework sheet or test: three or more numbered problems in counting order ("1) … 2) … 3) …" on
 * one line, or "1." / "1)" / "1-" at line starts). Refused by code before any model call.
 */
export function looksLikeSheet(text: string): boolean {
  const t = plain(text);
  const nums: number[] = [];
  for (const m of t.matchAll(/(?:^|\n)\s*(\d{1,2})\s*[).\-–—]\s*\S/gu)) nums.push(Number(m[1]));
  for (const m of t.matchAll(/(?<![\d\p{L}(])(\d{1,2})\)\s*\S/gu)) nums.push(Number(m[1]));
  const set = [...new Set(nums)].sort((a, b) => a - b);
  let run = 1;
  for (let i = 1; i < set.length; i++) {
    run = set[i] === set[i - 1] + 1 ? run + 1 : 1;
    if (run >= 3) return true;
  }
  return false;
}
