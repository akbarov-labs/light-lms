// Loads questions that were read from a center's book outside the app (for example by Claude Code reading the
// page images, on a subscription instead of the API) into its question bank as drafts: same checks and key
// rules as scripts/import-questions.ts, no model calls. The JSON files hold the center's material: keep them
// out of git.
//
//   npx tsx --env-file=.env scripts/load-questions.ts <center id|slug> <dir> [--dry-run]
//
// On the server (DEPLOY.md §11e, "Running a script") the files go in on stdin as one bundle:
//
//   npx tsx scripts/load-questions.ts --pack <dir> > bank.json                     (locally)
//   cat bank.json | … run -T --rm migrate npx tsx scripts/load-questions.ts <center id|slug> - [--dry-run]
//
// <dir> holds
//   read-*.json   { sections: [{code, title}], questions: [...] } in the shape of EXTRACT_SCHEMA
//                 (src/lib/questions/extract.ts), with `page` the page number in the whole book and
//                 `answer` the reader's own solve;
//   solve-*.json  { answers: [{section, number, answer}] }: a second solve by someone who saw only the
//                 question and its options, never the book's answer;
//   answers-*.json (optional) the book's answer tables: { sections: {"1.1.4": {"1": "B"}}, bulletins:
//                 {"97-5": {"10": "A"}} } — a question without a printed answer takes its section's table
//                 entry, else its bulletin's by its source code (97-5-10 → year 97, bulletin 5, question 10).
// Files are read in name order; a question read twice (pages overlap) keeps its first reading. A question
// already in the bank is left as it is, so loading again never undoes a review.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";
import { db } from "../src/lib/db";
import { EXTRACTED, toExtracted, type ExtractedQuestion } from "../src/lib/questions/extract";
import { codeChain, decideKey, keyOf } from "../src/lib/questions/keys";
import { saveImported, type ImportItem } from "../src/lib/services/questions";

const SOLVES = z.object({ answers: z.array(z.object({ section: z.string(), number: z.number().int(), answer: z.string() })) });
const keyOfQ = (section: string, number: number) => `${section.trim()}#${number}`;

interface Bundle {
  reads: unknown[];
  solves: unknown[];
  answers?: unknown[];
}

const TABLES = z.object({ sections: z.record(z.string(), z.record(z.string(), z.string())), bulletins: z.record(z.string(), z.record(z.string(), z.string())) });

/** The read-* and solve-* files of a folder, in name order. */
function packDir(dir: string): Bundle {
  const files = readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  const load = (f: string) => JSON.parse(readFileSync(join(dir, f), "utf8")) as unknown;
  return { reads: files.filter((f) => f.startsWith("read-")).map(load), solves: files.filter((f) => f.startsWith("solve-")).map(load), answers: files.filter((f) => f.startsWith("answers-")).map(load) };
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] === "--pack") {
    if (!args[1]) throw new Error("usage: tsx scripts/load-questions.ts --pack <dir> > bank.json");
    process.stdout.write(JSON.stringify(packDir(args[1])));
    return;
  }
  const [who, dir] = args;
  const dryRun = args.includes("--dry-run");
  if (!who || !dir || who.startsWith("--") || (dir.startsWith("--") && dir !== "-")) {
    console.error("usage: tsx scripts/load-questions.ts <center id|slug> <dir|-> [--dry-run]   ·   --pack <dir> > bank.json");
    process.exit(1);
  }
  const center = await db.center.findFirst({ where: { OR: [{ id: who }, { slug: who }] }, select: { id: true, name: true } });
  if (!center) throw new Error(`no center ${who}`);
  const bundle: Bundle = dir === "-" ? (JSON.parse(readFileSync(0, "utf8")) as Bundle) : packDir(dir);

  const titles = new Map<string, string>();
  const theories = new Map<string, string>();
  const questions = new Map<string, ExtractedQuestion>();
  let dropped = 0;
  for (const file of bundle.reads) {
    const raw = EXTRACTED.parse(file);
    // pages are already book pages: first page 1, no upper clamp
    const got = toExtracted(raw, 1, 100_000);
    dropped += raw.questions.length - got.questions.length;
    for (const s of got.sections) {
      if (!titles.has(s.code)) titles.set(s.code, s.title);
      // a range that cuts an explanation off reads less of it than the next one: keep the longer reading
      if (s.theory && s.theory.length > (theories.get(s.code)?.length ?? 0)) theories.set(s.code, s.theory);
    }
    for (const q of got.questions) if (!questions.has(keyOfQ(q.section, q.number))) questions.set(keyOfQ(q.section, q.number), q);
  }
  // the book's answer tables stand in for a printed answer the page itself does not show
  let fromTables = 0;
  for (const file of bundle.answers ?? []) {
    const t = TABLES.parse(file);
    for (const q of questions.values()) {
      if (q.stated) continue;
      const [yy, b, n] = q.ref?.split("-") ?? [];
      const raw = t.sections[q.section]?.[String(q.number)] ?? (yy && b && n ? t.bulletins[`${yy}-${Number(b)}`]?.[String(Number(n))] : undefined);
      const key = keyOf(raw, q.options.length);
      if (key) {
        q.stated = key;
        fromTables++;
      }
    }
  }
  const second = new Map<string, string>();
  for (const file of bundle.solves) for (const a of SOLVES.parse(file).answers) second.set(keyOfQ(a.section, a.number), a.answer);

  const items: ImportItem[] = [...questions.entries()].map(([k, q]) => ({ q, solve2: second.has(k) ? keyOf(second.get(k), q.options.length) : null }));
  const checks: Record<string, number> = {};
  for (const it of items) {
    const c = decideKey(it.q.stated, [it.q.solve, it.solve2], it.q.figure).keyCheck;
    checks[c] = (checks[c] ?? 0) + 1;
  }
  const noSecond = items.filter((i) => i.solve2 === null).length;
  console.log(`${center.name}: ${items.length} questions from ${bundle.reads.length} readings, ${dropped} dropped by the checks, ${noSecond} without a second solve`);
  console.log(`topics with an explanation: ${theories.size}, printed answers taken from the book's tables: ${fromTables}`);
  console.log(`keys: ${Object.entries(checks).map(([k, n]) => `${k} ${n}`).join(", ")}`);
  if (dryRun || !items.length) {
    if (dryRun) console.log("dry run: nothing saved");
    return;
  }
  const codes = new Set(items.flatMap((i) => codeChain(i.q.section)));
  // topics with an explanation but no question on these pages yet are saved too
  for (const code of theories.keys()) codeChain(code).forEach((c) => codes.add(c));
  const sections = [...codes].filter((c) => titles.has(c)).map((code) => ({ code, title: titles.get(code)!, theory: theories.get(code) }));
  const saved = await saveImported(center.id, sections, items);
  console.log(`saved ${saved.created}, already there ${saved.skipped}`);
}

main()
  .catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
