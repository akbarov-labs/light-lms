// Reads a center's own book (PDF of test questions) into its question bank as drafts; the owner reviews
// them on /questions. The book is the center's material: keep the PDF out of git. Billed model calls —
// try a few pages first. Locally:
//
//   npx tsx --env-file=.env scripts/import-questions.ts <center id|slug> <book.pdf> --pages 5-12 [--dry-run]
//
// On the server (DEPLOY.md §11e, "Running a script"), the PDF goes in on stdin:
//
//   cat book.pdf | … run -T --rm migrate npx tsx scripts/import-questions.ts <center id|slug> - [--pages a-b] [--chunk 4] [--model m]
//
// A question already in the bank (same section and number) is not read again, so a stopped run is
// resumed by running it again; the summary lists page ranges that failed.
import { readFileSync } from "node:fs";
import { db } from "../src/lib/db";
import { anthropicApiKey, questionModel } from "../src/lib/env";
import { costOf, importBook } from "../src/lib/questions/import";

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};

async function main() {
  const [who, file] = args;
  if (!who || !file || who.startsWith("--") || file.startsWith("--")) {
    console.error("usage: tsx scripts/import-questions.ts <center id|slug> <book.pdf|-> [--pages a-b] [--chunk 4] [--model m] [--dry-run]");
    process.exit(1);
  }
  if (!anthropicApiKey()) throw new Error("ANTHROPIC_API_KEY is not set");
  const center = await db.center.findFirst({ where: { OR: [{ id: who }, { slug: who }] }, select: { id: true, name: true } });
  if (!center) throw new Error(`no center ${who}`);
  let from: number | undefined;
  let to: number | undefined;
  const pages = value("pages");
  if (pages) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(pages);
    if (!m) throw new Error("--pages takes a-b, e.g. 5-12");
    from = Number(m[1]);
    to = Number(m[2] ?? m[1]);
  }
  const chunk = Number(value("chunk") ?? 4);
  const model = value("model") ?? questionModel();
  const dryRun = flag("dry-run");
  const pdf = new Uint8Array(readFileSync(file === "-" ? 0 : file));
  console.log(`${dryRun ? "[dry run, nothing saved] " : ""}${center.name}: reading ${pages ? `pages ${pages}` : "the whole book"} with ${model}, ${chunk} pages per call`);

  const r = await importBook({ centerId: center.id, pdf, from, to, chunk, model, dryRun, log: (l) => console.log(l) });
  console.log("");
  console.log(`pages: ${r.pages}, questions read: ${r.read}${dryRun ? "" : `, saved: ${r.created}, already there: ${r.skipped}`}`);
  console.log(`keys: ${Object.entries(r.keyChecks).map(([k, n]) => `${k} ${n}`).join(", ") || "—"}`);
  console.log(`tokens: ${r.usage.inputTokens} in, ${r.usage.outputTokens} out ≈ $${costOf(r.usage).toFixed(2)}`);
  if (r.failed.length) console.log(`failed, run again: ${r.failed.map(([a, b]) => `--pages ${a}-${b}`).join("  ")}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
