// How well the model reads homework answers from notebook photos (the first pilot center sends 15–20 real
// photos, names hidden). Needs ANTHROPIC_API_KEY; every photo is one paid model call (~$0.01).
//
//   npx tsx --env-file=.env scripts/homework-photo-eval.ts <folder> --key "1) B 2) C 3) -4 …" [--truth truth.json] [--model claude-sonnet-5-5]
//
// --key       the homework's answer key: gives the number of questions and which are letters or numbers
//             (the model never sees it); the script also marks each read answer right or wrong against it.
// --truth     optional JSON { "photo1.jpg": "1) B 2) D 3) -4", … }: what the student actually wrote, typed by
//             a person. With it the script prints reading accuracy (read = written), the number that matters:
//             a misread answer marks a student wrong for something they got right.
import { readdirSync, readFileSync } from "node:fs";
import { extname, join } from "node:path";
import { parseKey, isCorrect, canonical, keyKind } from "../src/lib/homework/grade";
import { readPhotoWithModel, type PhotoMediaType } from "../src/lib/homework/photo";
import { homeworkPhotoModel } from "../src/lib/env";

const args = process.argv.slice(2);
const value = (name: string) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const TYPES: Record<string, PhotoMediaType> = { ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp" };

async function main() {
  const dir = args[0];
  const keyText = value("key");
  if (!dir || dir.startsWith("--") || !keyText) {
    console.error('usage: tsx scripts/homework-photo-eval.ts <folder> --key "1) B 2) -4 …" [--truth truth.json] [--model m]');
    process.exit(1);
  }
  const key = parseKey(keyText);
  if (!key.ok) throw new Error(`the key: ${JSON.stringify(key)}`);
  const kinds = key.items.map(keyKind);
  const truthFile = value("truth");
  const truth: Record<string, string> = truthFile ? JSON.parse(readFileSync(truthFile, "utf8")) : {};
  const model = value("model") ?? homeworkPhotoModel();
  const files = readdirSync(dir).filter((f) => TYPES[extname(f).toLowerCase()]).sort();
  console.log(`${files.length} photos, ${kinds.length} questions, model ${model}\n`);

  let read = 0, unsure = 0, written = 0, readRight = 0, misread = 0, missed = 0, tokensIn = 0, tokensOut = 0;
  for (const f of files) {
    const r = await readPhotoWithModel({ image: readFileSync(join(dir, f)), mediaType: TYPES[extname(f).toLowerCase()], kinds, model });
    tokensIn += r.usage.inputTokens + r.usage.cacheReadTokens + r.usage.cacheWriteTokens;
    tokensOut += r.usage.outputTokens;
    if (r.failed) {
      console.log(`${f}: FAILED`);
      continue;
    }
    read += r.answers.length;
    unsure += r.answers.filter((a) => a.unsure).length;
    const line = r.answers.map((a) => `${a.q + 1})${a.raw}${a.unsure ? "?" : ""}${isCorrect(key.items[a.q], a.raw) ? "✓" : "✗"}`).join(" ");
    console.log(`${f}: ${line}`);
    const t = truth[f] ? parseKey(truth[f]) : null;
    if (t?.ok) {
      const got = new Map(r.answers.map((a) => [a.q, canonical(a.raw) ?? a.raw]));
      t.items.forEach((w, q) => {
        if (!w) return;
        written++;
        const g = got.get(q);
        if (g === undefined) missed++;
        else if (isCorrect(w, g)) readRight++;
        else {
          misread++;
          console.log(`    misread ${q + 1}: wrote ${w}, read ${g}`);
        }
      });
    }
  }
  console.log(`\nread ${read} answers (${unsure} marked unsure), tokens in ${tokensIn} out ${tokensOut}`);
  if (written) console.log(`against the truth: ${readRight}/${written} read right (${((100 * readRight) / written).toFixed(1)}%), ${misread} misread, ${missed} not read`);
}

main().catch((e) => {
  console.error(e.message ?? e);
  process.exit(1);
});
