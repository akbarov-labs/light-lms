// Homework answer keys and grading (pilot). Exact checking is code's job, never a model's.
//
// A key item is one question's answer: a choice letter (A–E) or a number — an integer, a decimal with
// "." or "," ("2.5", "2,5"), or a fraction of integers ("3/4"). Several accepted answers are joined by
// "|" ("2|-2"). Numbers compare by value, exactly (rationals in BigInt): 0.75 = 3/4 = ,75.

export type Answer = { kind: "choice"; letter: string } | { kind: "number"; num: bigint; den: bigint };
export type KeyKind = Answer["kind"];

export const MAX_QUESTIONS = 100;

/** Cyrillic letters a phone keyboard gives for A–E: look-alikes (А В С Е) and Д for D. */
const CYRILLIC: Record<string, string> = { А: "A", В: "B", С: "C", Д: "D", Е: "E" };

/** Unicode minus and dashes → "-", full-width forms folded (NFKC). */
function clean(s: string): string {
  return s.normalize("NFKC").replace(/[−‐-―]/g, "-");
}

function choiceLetter(s: string): string | null {
  const c = s.toUpperCase();
  const latin = CYRILLIC[c] ?? c;
  return /^[A-E]$/.test(latin) ? latin : null;
}

const NUMBER = /^([+-]?)(\d*)(?:[.,](\d+))?$/;
const FRACTION = /^([+-]?)(\d+)\/(\d+)$/;

/**
 * One answer as typed by a student or in a key: "B", "b", "В" (Cyrillic), "B)", "-4", "x=-4", "2,5",
 * "3/4", "1 000". Null when it is neither a choice nor a number.
 */
export function parseAnswer(raw: string): Answer | null {
  const s = clean(raw).trim().replace(/\s+/g, "");
  if (!s) return null;
  // "B)", "B." — a letter with the punctuation people add after it
  const letter = /^(.)[.)]?$/u.exec(s);
  if (letter) {
    const l = choiceLetter(letter[1]);
    if (l) return { kind: "choice", letter: l };
  }
  return parseNumber(numberText(s));
}

/** "x=5" / "y=-2" → the number without the variable; a trailing "." or ")" dropped. */
function numberText(s: string): string {
  return s.replace(/^[a-zA-Zа-яА-Я]=/u, "").replace(/[.)]$/, "");
}

function parseNumber(s: string): Answer | null {
  const f = FRACTION.exec(s);
  if (f) {
    const den = BigInt(f[3]);
    if (den === BigInt(0)) return null;
    const num = BigInt(f[2]) * (f[1] === "-" ? BigInt(-1) : BigInt(1));
    return { kind: "number", num, den };
  }
  const n = NUMBER.exec(s);
  if (n && (n[2] !== "" || n[3] !== undefined)) {
    const frac = n[3] ?? "";
    const den = BigInt(10) ** BigInt(frac.length);
    const num = BigInt((n[2] || "0") + frac) * (n[1] === "-" ? BigInt(-1) : BigInt(1));
    return { kind: "number", num, den };
  }
  return null;
}

function same(a: Answer, b: Answer): boolean {
  if (a.kind === "choice") return b.kind === "choice" && a.letter === b.letter;
  if (b.kind === "choice") return false;
  return a.num * b.den === b.num * a.den;
}

/** The accepted answers of a key item ("2|-2" → two). */
function alternatives(item: string): Answer[] {
  return item.split("|").map((x) => parseAnswer(x)).filter((x): x is Answer => x !== null);
}

/** Choice or number: decides the bot's keyboard (letters) or "type the number". */
export function keyKind(item: string): KeyKind {
  return alternatives(item)[0]?.kind ?? "number";
}

export function isCorrect(item: string, given: string | null | undefined): boolean {
  if (!given) return false;
  const g = parseAnswer(given);
  return g !== null && alternatives(item).some((a) => same(a, g));
}

/** An answer as stored: "B", or the number as typed with "," → "." and the dashes and spaces cleaned. */
export function canonical(raw: string): string | null {
  const a = parseAnswer(raw);
  if (!a) return null;
  if (a.kind === "choice") return a.letter;
  return numberText(clean(raw).trim().replace(/\s+/g, "")).replace(",", ".").replace(/^\+/, "");
}

// ------------------------------------------------------------------ keys

export type KeyResult =
  | { ok: true; items: string[] }
  | { ok: false; error: "empty" | "tooMany" }
  | { ok: false; error: "badToken" | "mixed" | "numbering"; index: number; token: string };

/**
 * The teacher's key as typed: answers separated by spaces, new lines, ";" or ", ", optionally numbered
 * ("1) B", "1.B", "1-B", "1B", "1:-4"), or a run of letters ("ABDCA", "1A2B3C"). A number prefix must be
 * the question's position, so a skipped or doubled question is caught instead of shifting every answer.
 */
export function parseKey(text: string): KeyResult {
  const raw = clean(text).replace(/,\s+/g, " ").replace(/;/g, " ").trim();
  if (!raw) return { ok: false, error: "empty" };
  const tokens = raw.split(/\s+/);
  const items: string[] = [];
  let pendingNumber: { n: number; token: string } | null = null;

  const push = (value: string, numbered: number | null, token: string): KeyResult | null => {
    const expected = items.length + 1;
    if (numbered !== null && numbered !== expected) return { ok: false, error: "numbering", index: expected, token };
    const alts = value.split("|");
    const parsed = alts.map((x) => parseAnswer(x));
    if (alts.some((x) => !x) || parsed.some((p) => p === null)) return { ok: false, error: "badToken", index: expected, token };
    if (new Set(parsed.map((p) => p!.kind)).size > 1) return { ok: false, error: "mixed", index: expected, token };
    items.push(alts.map((x) => canonical(x)!).join("|"));
    return null;
  };

  for (const token of tokens) {
    // a bare "1)" / "1." / "1:" / "1-" before the answer
    const marker = /^(\d+)[).:\-]$/.exec(token);
    if (marker && !pendingNumber) {
      pendingNumber = { n: Number(marker[1]), token };
      continue;
    }
    if (pendingNumber) {
      const err = push(token, pendingNumber.n, `${pendingNumber.token} ${token}`);
      pendingNumber = null;
      if (err) return err;
      continue;
    }
    // "1A2B3C" (numbers glued to letters) or "ABDCA" (letters only)
    if (/^(\d+[A-Ea-e])+$/.test(token) && /^\d+[A-Ea-e]\d/.test(token)) {
      for (const m of token.matchAll(/(\d+)([A-Ea-e])/g)) {
        const err = push(m[2], Number(m[1]), m[0]);
        if (err) return err;
      }
      continue;
    }
    if (/^[A-Ea-e]{2,}$/.test(token)) {
      for (const ch of token) {
        const err = push(ch, null, token);
        if (err) return err;
      }
      continue;
    }
    // "1)B", "1:-4", "1.B" (not "1.5"), "1-B" (not "1-4"), "1B"
    const prefixed = /^(\d+)(?:[):]|\.(?=[^\d])|-(?=[A-Za-zА-Яа-я])|(?=[A-Ea-eАВСДЕавсде]$))(.+)$/u.exec(token);
    if (prefixed) {
      const err = push(prefixed[2], Number(prefixed[1]), token);
      if (err) return err;
      continue;
    }
    const err = push(token, null, token);
    if (err) return err;
  }
  if (pendingNumber) return { ok: false, error: "badToken", index: items.length + 1, token: pendingNumber.token };
  if (items.length > MAX_QUESTIONS) return { ok: false, error: "tooMany" };
  return { ok: true, items };
}

// ------------------------------------------------------------------ report

export interface Submission {
  studentId: string;
  answers: string[];
}

export interface QuestionStat {
  /** 1-based question number */
  n: number;
  key: string;
  correct: number;
  /** students who answered anything at all (the question's denominator) */
  of: number;
  /** wrong answers grouped by what was written, most common first: the class's typical mistake on top */
  wrong: { given: string; studentIds: string[] }[];
  /** answered other questions but left this one empty */
  blank: string[];
  /** everyone who answered got it right: the lesson can skip it */
  allCorrect: boolean;
}

export interface HomeworkReport {
  questions: QuestionStat[];
  scores: Map<string, { correct: number; answered: number }>;
  /** students with at least one answer */
  answeredBy: string[];
}

/** Per-question results in question order, computed from the current key. */
export function homeworkReport(key: string[], subs: Submission[]): HomeworkReport {
  const active = subs.filter((s) => s.answers.some((a) => a.trim() !== ""));
  const scores = new Map(active.map((s) => [s.studentId, { correct: 0, answered: 0 }]));
  const questions = key.map((item, i): QuestionStat => {
    const wrong = new Map<string, string[]>();
    const blank: string[] = [];
    let correct = 0;
    for (const s of active) {
      const given = (s.answers[i] ?? "").trim();
      const score = scores.get(s.studentId)!;
      if (!given) {
        blank.push(s.studentId);
        continue;
      }
      score.answered++;
      if (isCorrect(item, given)) {
        correct++;
        score.correct++;
      } else {
        const shown = canonical(given) ?? given;
        wrong.set(shown, [...(wrong.get(shown) ?? []), s.studentId]);
      }
    }
    return {
      n: i + 1,
      key: item,
      correct,
      of: active.length,
      wrong: [...wrong.entries()].map(([given, studentIds]) => ({ given, studentIds })).sort((a, b) => b.studentIds.length - a.studentIds.length),
      blank,
      allCorrect: active.length > 0 && correct === active.length,
    };
  });
  return { questions, scores, answeredBy: active.map((s) => s.studentId) };
}

// ------------------------------------------------------------------ the student's own check

export type Hint = "sign" | "decimal";

export interface CheckResult {
  correct: number;
  total: number;
  /** 0-based questions answered wrong, with a hint when the mistake has a recognisable shape */
  wrong: { q: number; hint: Hint | null }[];
  /** 0-based questions left empty */
  blank: number[];
}

/**
 * The student's check: which questions are wrong, never the right answer (the client: "do not tell the
 * homework answers"). A hint only names the kind of slip: the right number with the wrong sign, or the
 * right digits with the decimal point in the wrong place.
 */
export function checkAnswers(key: string[], answers: string[]): CheckResult {
  const wrong: CheckResult["wrong"] = [];
  const blank: number[] = [];
  let correct = 0;
  key.forEach((item, q) => {
    const given = (answers[q] ?? "").trim();
    if (!given) return void blank.push(q);
    if (isCorrect(item, given)) correct++;
    else wrong.push({ q, hint: hintFor(item, given) });
  });
  return { correct, total: key.length, wrong, blank };
}

export function hintFor(item: string, given: string): Hint | null {
  const g = parseAnswer(given);
  if (!g || g.kind !== "number" || g.num === BigInt(0)) return null;
  for (const a of alternatives(item)) {
    if (a.kind !== "number") continue;
    // -g = a
    if (-g.num * a.den === a.num * g.den) return "sign";
    // g = a × 10^k, k ≠ 0 (both written as decimals: same digits, point moved)
    for (let k = 1; k <= 6; k++) {
      const p = BigInt(10) ** BigInt(k);
      if (g.num * a.den === a.num * g.den * p || g.num * a.den * p === a.num * g.den) return "decimal";
    }
  }
  return null;
}

/** Questions right at the last check: the student cannot change them any more. */
export function lockedQuestions(key: string[], checkedAnswers: string[]): Set<number> {
  const out = new Set<number>();
  key.forEach((item, q) => {
    if (isCorrect(item, checkedAnswers[q])) out.add(q);
  });
  return out;
}
