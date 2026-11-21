// Reading a center's own book (a PDF of test questions) into its question bank, a few pages per model call,
// and solving each question a second time in a separate call. The model transcribes and proposes keys; code
// decides how sure a key is (keys.ts) and a person approves every question (services/questions.ts).
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { anthropicApiKey } from "@/lib/env";
import { fallbackParams } from "@/lib/agent/loop";
import { isTopicCode, keyOf } from "./keys";

export type CreateMessage = (params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming) => Promise<Anthropic.Beta.BetaMessage>;

let client: Anthropic | undefined;
/** Streaming under the hood: a few pages of questions can take minutes. */
export function defaultCreate(): CreateMessage {
  client ??= new Anthropic({ apiKey: anthropicApiKey() });
  const c = client;
  return (p) => c.beta.messages.stream(p).finalMessage();
}

export interface Usage {
  inputTokens: number;
  outputTokens: number;
}
const usageOf = (m: Anthropic.Beta.BetaMessage): Usage => ({ inputTokens: m.usage.input_tokens + (m.usage.cache_read_input_tokens ?? 0) + (m.usage.cache_creation_input_tokens ?? 0), outputTokens: m.usage.output_tokens });
const textOf = (m: Anthropic.Beta.BetaMessage) => m.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");

const MATH_STYLE = `Keep the book's words (Uzbek) as plain text and put every formula, number expression or variable between $…$ as LaTeX, so the app can draw it: powers $2^{100}$, $a^{n+1}$; roots $\\sqrt{x+1}$, $\\sqrt[3]{8}$; fractions $\\frac{3}{4}$; mixed numbers $2\\frac{1}{3}$; multiplication $\\cdot$; division as the book does ($:$ or $/$); a number written by its digits with a bar over them $\\overline{a_1a_2\\ldots a_n}$; indices $a_1$; repeating decimals $0,(3)$; keep decimal commas ($2{,}5$). Plain whole numbers and intervals may stay as text ([4; 8]). Answer options follow the same rule.`;

// ------------------------------------------------------------------ reading pages

const EXTRACT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["sections", "questions"],
  properties: {
    sections: {
      type: "array",
      description: "every section heading that appears on these pages, with the chapters and sections above it",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["code", "title", "theory"],
        properties: {
          code: { type: "string", description: "the book's number: \"1\", \"1.2\", \"1.2.3\"" },
          title: { type: "string" },
          theory: { type: "string", description: "the explanation under the heading before its questions (definitions, rules, examples), formulas in $…$; empty when none or not on these pages" },
        },
      },
    },
    questions: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["section", "number", "ref", "text", "options", "stated", "solution", "figure", "page", "answer"],
        properties: {
          section: { type: "string", description: "code of the section the question is in" },
          number: { type: "integer", description: "the question's number in its section" },
          ref: { type: "string", description: "the source code in brackets before the question, e.g. 96-3-1; empty when none" },
          text: { type: "string" },
          options: { type: "array", items: { type: "string" }, description: "the options in order A, B, C, D (E); empty for an open question" },
          stated: { type: "string", description: "the answer the book prints for this question (Javob: 27 (B) → B); empty when it prints none" },
          solution: { type: "string", description: "the book's worked solution (Yechish) as plain text; empty when none" },
          figure: { type: "boolean", description: "true when the question needs a picture, graph or drawing the text cannot carry" },
          page: { type: "integer", description: "1-based page number within these pages where the question starts" },
          answer: { type: "string", description: "your own answer: solve the question yourself, without looking at the printed answer; the option letter, or the number for an open question; empty if you cannot" },
        },
      },
    },
  },
} as const;

export const EXTRACTED = z.object({
  sections: z.array(z.object({ code: z.string(), title: z.string(), theory: z.string().optional() })).max(200),
  questions: z
    .array(
      z.object({
        section: z.string(),
        number: z.number().int(),
        ref: z.string(),
        text: z.string(),
        options: z.array(z.string()).max(6),
        stated: z.string(),
        solution: z.string(),
        figure: z.boolean(),
        page: z.number().int(),
        answer: z.string(),
      }),
    )
    .max(400),
});

const EXTRACT_SYSTEM = `You copy test questions from pages of a school math book into structured data, for a tutoring center that owns the book. You copy exactly what is printed and solve each question carefully on your own.`;

export function extractPrompt(sectionAtStart: { code: string; title: string } | null): string {
  return `These are consecutive pages of the book. Pages have two columns: read the left column top to bottom, then the right.
${sectionAtStart ? `The pages start inside section ${sectionAtStart.code} "${sectionAtStart.title}" unless a new heading appears first.` : "The pages start at the beginning of a section or before the first one."}

List every numbered question on these pages:
- section and number as printed; ref = the code in brackets before it, such as 96-3-1, else empty;
- text: the question only (not the options); ${MATH_STYLE}
- options: the answer options in order A, B, C, D (E), without the letters;
- stated: when the book itself gives the answer to this question (a worked solution ending "Javob: …"), the option letter (the number for a question without options); else empty;
- solution: the worked solution ("Yechish") when there is one, formulas in $…$ as above, else empty;
- figure: true when the question depends on a picture or drawing;
- answer: solve the question yourself and give the option letter (the number for a question without options). Do not copy the printed answer: work it out, so a misprint can be caught. Empty if you cannot.

Leave out a question the first page continues from an earlier page, and a question cut off at the end of the last page: neighbouring pages are read separately. Theory, rules and formulas that are not numbered questions are not questions. List the section headings you see (and the chapter above them) in "sections", each with its theory: the explanation printed under the heading before its questions (definitions, rules with their numbers, worked examples), copied whole with formulas in $…$ and "\\n" between paragraphs and rules; empty when there is none or when it is above the first page; when it runs past the last page, copy what is there.`;
}

export interface ExtractedQuestion {
  section: string;
  number: number;
  ref: string | null;
  text: string;
  options: string[];
  /** the printed answer in key form */
  stated: string | null;
  solution: string | null;
  figure: boolean;
  /** 1-based page in the whole book */
  page: number;
  /** the first solve, in key form */
  solve: string | null;
}

/** Longest topic explanation kept. */
export const MAX_THEORY = 20_000;

export interface BookSection {
  code: string;
  title: string;
  theory?: string;
}

export interface ExtractResult {
  sections: BookSection[];
  questions: ExtractedQuestion[];
  usage: Usage;
  /** "max_tokens": too many questions for one call — read fewer pages at a time */
  failed: false | "max_tokens" | "error";
}

/** The model's list → what the bank can take: known sections, 2–5 options, keys that fit their options. */
export function toExtracted(raw: z.infer<typeof EXTRACTED>, firstPage: number, pageCount: number): Pick<ExtractResult, "sections" | "questions"> {
  const sections = raw.sections
    .filter((s) => isTopicCode(s.code.trim()) && s.title.trim())
    .map((s) => ({ code: s.code.trim(), title: s.title.trim().slice(0, 200), ...(s.theory?.trim() ? { theory: s.theory.trim().slice(0, MAX_THEORY) } : {}) }));
  const questions: ExtractedQuestion[] = [];
  for (const q of raw.questions) {
    const options = q.options.map((o) => o.trim()).filter(Boolean);
    if (!isTopicCode(q.section.trim()) || q.number < 1 || !q.text.trim() || options.length === 1 || options.length > 5) continue;
    const page = Math.min(Math.max(q.page, 1), pageCount);
    questions.push({
      section: q.section.trim(),
      number: q.number,
      ref: /^[\w-]{1,20}$/.test(q.ref.trim()) ? q.ref.trim() : null,
      text: q.text.trim().slice(0, 4000),
      options: options.map((o) => o.slice(0, 500)),
      stated: keyOf(q.stated, options.length),
      solution: q.solution.trim() ? q.solution.trim().slice(0, 4000) : null,
      figure: q.figure,
      page: firstPage + page - 1,
      solve: keyOf(q.answer, options.length),
    });
  }
  return { sections, questions };
}

export async function extractPages(p: { pdf: Uint8Array; firstPage: number; pageCount: number; sectionAtStart: { code: string; title: string } | null; model: string; create?: CreateMessage }): Promise<ExtractResult> {
  const none = { sections: [], questions: [] };
  let res: Anthropic.Beta.BetaMessage;
  try {
    res = await (p.create ?? defaultCreate())({
      model: p.model,
      max_tokens: 64000,
      ...fallbackParams(p.model),
      output_config: { effort: "high", format: { type: "json_schema", schema: EXTRACT_SCHEMA as unknown as Record<string, unknown> } },
      system: EXTRACT_SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: Buffer.from(p.pdf).toString("base64") } },
            { type: "text", text: extractPrompt(p.sectionAtStart) },
          ],
        },
      ],
    });
  } catch (e) {
    console.error("question import: model call failed", e);
    return { ...none, usage: { inputTokens: 0, outputTokens: 0 }, failed: "error" };
  }
  const usage = usageOf(res);
  if (res.stop_reason === "max_tokens") return { ...none, usage, failed: "max_tokens" };
  if (res.stop_reason === "refusal") return { ...none, usage, failed: "error" };
  try {
    return { ...toExtracted(EXTRACTED.parse(JSON.parse(textOf(res))), p.firstPage, p.pageCount), usage, failed: false };
  } catch {
    return { ...none, usage, failed: "error" };
  }
}

// ------------------------------------------------------------------ the second, independent solve

const SOLVE_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answers"],
  properties: {
    answers: {
      type: "array",
      items: { type: "object", additionalProperties: false, required: ["id", "answer"], properties: { id: { type: "string" }, answer: { type: "string", description: "the option letter, or the number for an open question; empty if you cannot solve it" } } },
    },
  },
} as const;
const SOLVED = z.object({ answers: z.array(z.object({ id: z.string(), answer: z.string() })).max(400) });

export interface SolveItem {
  id: string;
  text: string;
  options: string[];
}

export function solvePrompt(items: SolveItem[]): string {
  const body = items
    .map((q) => `[${q.id}] ${q.text}${q.options.length ? "\n" + q.options.map((o, i) => `${"ABCDE"[i]}) ${o}`).join("   ") : "\n(open answer: give the number)"}`)
    .join("\n\n");
  return `Solve each question. Work carefully; check your result against the options. Give the option letter (or the number when there are no options), or leave it empty when the question cannot be solved as written.\n\n${body}`;
}

export async function solveQuestions(p: { items: SolveItem[]; model: string; create?: CreateMessage }): Promise<{ answers: Map<string, string | null>; usage: Usage; failed: boolean }> {
  const answers = new Map<string, string | null>();
  if (p.items.length === 0) return { answers, usage: { inputTokens: 0, outputTokens: 0 }, failed: false };
  let res: Anthropic.Beta.BetaMessage;
  try {
    res = await (p.create ?? defaultCreate())({
      model: p.model,
      max_tokens: 64000,
      ...fallbackParams(p.model),
      output_config: { effort: "high", format: { type: "json_schema", schema: SOLVE_SCHEMA as unknown as Record<string, unknown> } },
      system: "You are a careful mathematician solving school test questions.",
      messages: [{ role: "user", content: solvePrompt(p.items) }],
    });
  } catch (e) {
    console.error("question import: solve call failed", e);
    return { answers, usage: { inputTokens: 0, outputTokens: 0 }, failed: true };
  }
  const usage = usageOf(res);
  if (res.stop_reason !== "end_turn") return { answers, usage, failed: true };
  try {
    const optionCount = new Map(p.items.map((q) => [q.id, q.options.length]));
    for (const a of SOLVED.parse(JSON.parse(textOf(res))).answers) if (optionCount.has(a.id)) answers.set(a.id, keyOf(a.answer, optionCount.get(a.id)!));
    return { answers, usage, failed: false };
  } catch {
    return { answers, usage, failed: true };
  }
}
