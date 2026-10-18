// Exam scoring and certificate identifiers (v2). Pure functions; the service stores what they return.
import { randomInt } from "node:crypto";

export interface Section {
  name: string;
  max: number;
}
export interface LevelBand {
  min: number;
  level: string;
}

/** "Listening: 25" per line → sections. Blank lines are ignored; a bad line throws with its number. */
export function parseSections(text: string): Section[] {
  const out: Section[] = [];
  text.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const m = /^(.{1,60}?)\s*[:=]\s*(\d{1,4})$/.exec(line);
    if (!m || Number(m[2]) <= 0) throw new ExamInputError("sections", i + 1);
    out.push({ name: m[1].trim(), max: Number(m[2]) });
  });
  if (out.length > 12) throw new ExamInputError("sections", 13);
  return out;
}

/** "0: A1" / "40: A2" per line → bands sorted by min. */
export function parseBands(text: string, maxScore: number): LevelBand[] {
  const out: LevelBand[] = [];
  text.split("\n").forEach((raw, i) => {
    const line = raw.trim();
    if (!line) return;
    const m = /^(\d{1,4})\s*[:=]\s*(.{1,40})$/.exec(line);
    if (!m || Number(m[1]) > maxScore) throw new ExamInputError("bands", i + 1);
    out.push({ min: Number(m[1]), level: m[2].trim() });
  });
  return out.sort((a, b) => a.min - b.min);
}

export class ExamInputError extends Error {
  constructor(
    public field: "sections" | "bands" | "score",
    public line: number,
  ) {
    super(`${field}:${line}`);
  }
}

/** Sections' maxima must add up to the exam's maximum (a total that can't be reached is a typo). */
export function sectionsMax(sections: Section[]): number {
  return sections.reduce((s, x) => s + x.max, 0);
}

export interface ScoreInput {
  maxScore: number;
  passScore: number | null;
  sections: Section[];
  bands: LevelBand[];
}

export interface Scored {
  score: number;
  sectionScores: number[];
  passed: boolean | null;
  level: string | null;
  pct: number;
}

/**
 * Score one result. With sections the total is their sum (every section required, 0…its max);
 * without, `total` itself (0…maxScore). Returns null when the row is empty (not entered yet).
 */
export function scoreResult(exam: ScoreInput, entry: { total?: number | null; sections?: (number | null)[] }): Scored | null {
  let score: number;
  let sectionScores: number[] = [];
  if (exam.sections.length > 0) {
    const raw = entry.sections ?? [];
    if (raw.every((v) => v === null || v === undefined)) return null;
    sectionScores = exam.sections.map((s, i) => {
      const v = raw[i];
      if (v === null || v === undefined || !Number.isInteger(v) || v < 0 || v > s.max) throw new ExamInputError("score", i + 1);
      return v;
    });
    score = sectionScores.reduce((a, b) => a + b, 0);
  } else {
    if (entry.total === null || entry.total === undefined) return null;
    if (!Number.isInteger(entry.total) || entry.total < 0 || entry.total > exam.maxScore) throw new ExamInputError("score", 0);
    score = entry.total;
  }
  const passed = exam.passScore === null ? null : score >= exam.passScore;
  let level: string | null = null;
  for (const b of exam.bands) if (score >= b.min) level = b.level;
  return { score, sectionScores, passed, level, pct: exam.maxScore > 0 ? Math.round((score / exam.maxScore) * 100) : 0 };
}

export interface ExamStats {
  count: number;
  avg: number | null;
  passed: number;
  failed: number;
  best: number | null;
}

export function examStats(results: { score: number; passed: boolean | null }[]): ExamStats {
  const n = results.length;
  return {
    count: n,
    avg: n ? Math.round((results.reduce((s, r) => s + r.score, 0) / n) * 10) / 10 : null,
    passed: results.filter((r) => r.passed === true).length,
    failed: results.filter((r) => r.passed === false).length,
    best: n ? Math.max(...results.map((r) => r.score)) : null,
  };
}

/** "2026-0007" — year of issue and the center's running certificate number. */
export function certificateNumber(year: number, seq: number): string {
  return `${year}-${String(seq).padStart(4, "0")}`;
}

/** No 0/O, 1/I/L: a code read off paper and typed in must not be ambiguous. */
export const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";

export function verifyCode(length = 10, rnd: (max: number) => number = randomInt): string {
  let s = "";
  for (let i = 0; i < length; i++) s += CODE_ALPHABET[rnd(CODE_ALPHABET.length)];
  return s;
}

/** What a person typed (spaces, dashes, lower case) → the stored form, or null. */
export function normalizeCode(input: string): string | null {
  const s = input.toUpperCase().replace(/[\s-]/g, "");
  return s.length === 10 && [...s].every((c) => CODE_ALPHABET.includes(c)) ? s : null;
}
