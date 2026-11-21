// Which bank questions go into a test (pure). Random but reproducible: the same seed draws the same set,
// so a test rebuilt the same day, or a placement retried in the same chat, does not change under a person.
import { compareCodes } from "../questions/keys";

export interface PoolQuestion {
  id: string;
  /** the question's topic code: "1.2.3" */
  topicCode: string;
  number: number | null;
}

/** A small deterministic generator (mulberry32) seeded from a string (FNV-1a). */
export function seededRandom(seed: string): () => number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) h = Math.imul(h ^ seed.charCodeAt(i), 16777619);
  let a = h >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffled<T>(items: readonly T[], seed: string): T[] {
  const out = [...items];
  const rnd = seededRandom(seed);
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rnd() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/** Book order: by topic, then the question's number. Earlier topics come first, which is easy-first in a book. */
export const bookOrder = (a: PoolQuestion, b: PoolQuestion) => compareCodes(a.topicCode, b.topicCode) || (a.number ?? 0) - (b.number ?? 0) || a.id.localeCompare(b.id);

/** `n` questions of a topic test drawn at random from the pool, shown in book order. */
export function pickTopicQuestions(pool: readonly PoolQuestion[], n: number, seed: string): PoolQuestion[] {
  return shuffled(pool, seed).slice(0, Math.max(0, n)).sort(bookOrder);
}

/** One question to put in place of a removed one: not already in the test; null when the pool has none left. */
export function pickReplacement(pool: readonly PoolQuestion[], taken: ReadonlySet<string>, seed: string): PoolQuestion | null {
  return shuffled(pool.filter((q) => !taken.has(q.id)), seed)[0] ?? null;
}

/** Is `code` within what a person studied up to `reached`: an earlier topic, the topic itself, or a part of it. */
export const withinReach = (code: string, reached: string) => compareCodes(code, reached) <= 0 || code.startsWith(`${reached}.`);

/** Share of a placement drawn from the last topics before the reached one (the rest from everything earlier). */
export const RECENT_SHARE = 0.6;
/** How many of the last topics (with questions) count as "recent". */
export const RECENT_TOPICS = 3;

/**
 * A placement test: `n` questions from everything up to the topic the person reached, most of them from the
 * last few topics before it (what decides the group), the rest from earlier ones, shown easy-first (book order).
 */
export function pickPlacement(pool: readonly PoolQuestion[], reached: string, n: number, seed: string): PoolQuestion[] {
  const eligible = pool.filter((q) => withinReach(q.topicCode, reached));
  const topics = [...new Set(eligible.map((q) => q.topicCode))].sort(compareCodes);
  const recentTopics = new Set(topics.slice(-RECENT_TOPICS));
  const recent = shuffled(eligible.filter((q) => recentTopics.has(q.topicCode)), `${seed}:r`);
  const earlier = shuffled(eligible.filter((q) => !recentTopics.has(q.topicCode)), `${seed}:e`);
  const want = Math.min(n, eligible.length);
  const fromRecent = Math.min(recent.length, Math.max(want - earlier.length, Math.ceil(want * RECENT_SHARE)));
  return [...recent.slice(0, fromRecent), ...earlier.slice(0, want - fromRecent)].sort(bookOrder);
}
