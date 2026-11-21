// Reading a whole book (or a page range) into a center's bank: a few pages per call with one page of
// overlap, so a question that runs onto the next page is read whole in one of the calls; the second solve
// for every new question; a save after each chunk, so a stopped run resumes with --pages.
import { PDFDocument } from "pdf-lib";
import { db } from "@/lib/db";
import { saveImported, type ImportItem } from "@/lib/services/questions";
import { codeChain, decideKey } from "./keys";
import { extractPages, solveQuestions, type CreateMessage, type ExtractedQuestion, type Usage } from "./extract";

/** Price per million tokens (Opus 5.5), for the estimate the script prints. */
export const PRICE = { input: 4, output: 20 };
export const costOf = (u: Usage) => (u.inputTokens * PRICE.input + u.outputTokens * PRICE.output) / 1_000_000;

/** Page ranges for chunks of `size` pages that overlap by one page: 1–4, 4–7, 7–10 … */
export function chunkRanges(from: number, to: number, size: number): [number, number][] {
  const s = Math.max(2, size);
  const out: [number, number][] = [];
  for (let a = from; a <= to; ) {
    const b = Math.min(a + s - 1, to);
    out.push([a, b]);
    if (b === to) break;
    a = b;
  }
  return out;
}

/** A chunk that was too long for one answer, read as two smaller ones (overlapping when it can). */
export function splitRange([a, b]: [number, number]): [number, number][] {
  if (a === b) return [];
  if (b === a + 1) return [[a, a], [b, b]];
  const mid = Math.floor((a + b) / 2);
  return [[a, mid], [mid, b]];
}

export interface ImportOptions {
  centerId: string;
  pdf: Uint8Array;
  /** 1-based, inclusive; default the whole book */
  from?: number;
  to?: number;
  chunk?: number;
  model: string;
  dryRun?: boolean;
  create?: CreateMessage;
  log?: (line: string) => void;
}

export interface ImportReport {
  pages: number;
  read: number;
  created: number;
  skipped: number;
  usage: Usage;
  /** page ranges that could not be read, to run again */
  failed: [number, number][];
  keyChecks: Record<string, number>;
}

const keyOfQ = (section: string, number: number) => `${section}#${number}`;

export async function importBook(o: ImportOptions): Promise<ImportReport> {
  const log = o.log ?? (() => {});
  const book = await PDFDocument.load(o.pdf, { ignoreEncryption: true });
  const total = book.getPageCount();
  const from = Math.max(1, o.from ?? 1);
  const to = Math.min(total, o.to ?? total);
  const usage: Usage = { inputTokens: 0, outputTokens: 0 };
  const add = (u: Usage) => {
    usage.inputTokens += u.inputTokens;
    usage.outputTokens += u.outputTokens;
  };
  const report: ImportReport = { pages: Math.max(0, to - from + 1), read: 0, created: 0, skipped: 0, usage, failed: [], keyChecks: {} };

  // what the bank already holds: not read again, not paid for twice
  const held = await db.question.findMany({ where: { centerId: o.centerId, number: { not: null } }, select: { number: true, topic: { select: { code: true } } } });
  const seen = new Set(held.map((q) => keyOfQ(q.topic.code, q.number!)));
  const titles = new Map((await db.questionTopic.findMany({ where: { centerId: o.centerId }, select: { code: true, title: true } })).map((t) => [t.code, t.title]));
  const theories = new Map<string, string>();
  let sectionAtStart: { code: string; title: string } | null = null;

  const pagesOf = async ([a, b]: [number, number]) => {
    const part = await PDFDocument.create();
    const pages = await part.copyPages(book, Array.from({ length: b - a + 1 }, (_, i) => a - 1 + i));
    pages.forEach((p) => part.addPage(p));
    return part.save();
  };

  const readRange = async (range: [number, number]): Promise<ExtractedQuestion[] | null> => {
    const [a, b] = range;
    const r = await extractPages({ pdf: await pagesOf(range), firstPage: a, pageCount: b - a + 1, sectionAtStart, model: o.model, create: o.create });
    add(r.usage);
    r.sections.forEach((s) => {
      titles.set(s.code, s.title);
      // a range that cuts an explanation off reads less of it than the next one: keep the longer reading
      if (s.theory && s.theory.length > (theories.get(s.code)?.length ?? 0)) theories.set(s.code, s.theory);
    });
    if (r.failed === "max_tokens" && a !== b) {
      log(`  pages ${a}–${b}: too long for one answer, reading in smaller parts`);
      const out: ExtractedQuestion[] = [];
      for (const part of splitRange(range)) {
        const got = await readRange(part);
        if (got) out.push(...got);
      }
      return out;
    }
    if (r.failed) {
      log(`  pages ${a}–${b}: failed (${r.failed})`);
      report.failed.push(range);
      return null;
    }
    return r.questions;
  };

  for (const range of chunkRanges(from, to, o.chunk ?? 4)) {
    const [a, b] = range;
    const got = await readRange(range);
    if (!got) continue;
    got.sort((x, y) => x.page - y.page);
    const fresh: ExtractedQuestion[] = [];
    for (const q of got) {
      const k = keyOfQ(q.section, q.number);
      if (seen.has(k)) continue;
      seen.add(k);
      fresh.push(q);
    }
    // the section in force at the top of the next chunk's first page (this chunk's last page)
    const before = got.filter((q) => q.page < b);
    const last = before[before.length - 1];
    if (last) sectionAtStart = { code: last.section, title: titles.get(last.section) ?? last.section };

    const solved = await solveQuestions({ items: fresh.map((q, i) => ({ id: String(i), text: q.text, options: q.options })), model: o.model, create: o.create });
    add(solved.usage);
    if (solved.failed && fresh.length) log(`  pages ${a}–${b}: the second solve failed; these questions wait for a person`);
    const items: ImportItem[] = fresh.map((q, i) => ({ q, solve2: solved.answers.get(String(i)) ?? null }));
    report.read += items.length;
    for (const it of items) {
      const k = decideKey(it.q.stated, [it.q.solve, it.solve2], it.q.figure).keyCheck;
      report.keyChecks[k] = (report.keyChecks[k] ?? 0) + 1;
    }

    if (!o.dryRun && items.length) {
      // with the chapters above each section, so they get their titles too
      const codes = new Set(items.flatMap((i) => codeChain(i.q.section)));
      const sections = [...codes].filter((code) => titles.has(code)).map((code) => ({ code, title: titles.get(code)!, theory: theories.get(code) }));
      const saved = await saveImported(o.centerId, sections, items);
      report.created += saved.created;
      report.skipped += saved.skipped;
    }
    log(`pages ${a}–${b}: ${items.length} new questions · so far $${costOf(usage).toFixed(2)}`);
  }
  return report;
}
