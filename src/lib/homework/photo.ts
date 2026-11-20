// Reading a student's answers from a photo of the notebook (the first pilot center: students write the
// homework in notebooks and send photos). The model only transcribes what is written — it never sees the
// key, never solves, never grades; the student confirms what was read, and code grades as for typed
// answers. Off unless the center turned it on (settings.homework.photos) and ANTHROPIC_API_KEY is set.
import Anthropic from "@anthropic-ai/sdk";
import { z } from "zod";
import { db } from "@/lib/db";
import { anthropicApiKey, homeworkPhotoModel } from "@/lib/env";
import { monthKey, todayISO } from "@/lib/dates";
import { readSettings } from "@/lib/settings";
import { fallbackParams, type CreateMessage } from "@/lib/agent/loop";
import { capTokens } from "@/lib/agent/service";
import { canonical } from "./grade";

export type PhotoMediaType = "image/jpeg" | "image/png" | "image/webp";

export interface ReadAnswer {
  /** 0-based question */
  q: number;
  /** as the code will store it (canonical), or the raw text when it does not fit the question */
  raw: string;
  /** the model was not sure, or what it read does not fit the question's kind */
  unsure: boolean;
}

export type PhotoReadResult =
  | { ok: true; answers: ReadAnswer[] }
  | { ok: false; reason: "off" | "limit" | "failed" | "nothing" };

const OUTPUT = z.object({
  answers: z.array(z.object({ n: z.number().int(), answer: z.string(), sure: z.boolean() })).max(300),
});

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["answers"],
  properties: {
    answers: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["n", "answer", "sure"],
        properties: {
          n: { type: "integer", description: "the question number as written in the notebook" },
          answer: { type: "string", description: "the student's final answer exactly as written: a letter A–E, or a number such as -4, 2,5 or 3/4" },
          sure: { type: "boolean", description: "false when the handwriting is unclear, the answer is crossed out, or which question it belongs to is unclear" },
        },
      },
    },
  },
} as const;

const SYSTEM = `You transcribe a school student's handwritten math homework answers from a photo of a notebook page.
You only copy what the student wrote. You never solve a problem, never check or correct an answer, and never fill in an answer the student did not write.
The notebook may be in Uzbek (Latin or Cyrillic), Karakalpak or Russian; the answers are letters or numbers.`;

/** "1–30: letter (A–E); 31–50: number" from the question kinds. */
export function describeKinds(kinds: ("choice" | "number")[]): string {
  const parts: string[] = [];
  let start = 0;
  for (let i = 1; i <= kinds.length; i++) {
    if (i === kinds.length || kinds[i] !== kinds[start]) {
      const range = start === i - 1 ? `${start + 1}` : `${start + 1}–${i}`;
      parts.push(`${range}: ${kinds[start] === "choice" ? "a letter (A–E)" : "a number"}`);
      start = i;
    }
  }
  return parts.join("; ");
}

export function photoPrompt(kinds: ("choice" | "number")[]): string {
  return `This homework has ${kinds.length} questions, numbered 1 to ${kinds.length}. The answer of each question is ${describeKinds(kinds)}.

List every question number you can see on this page with the student's final answer:
- letter questions: the letter the student chose ("5) B", "5-B", a circled B);
- number questions: only the final answer — the number after the last "=" or after "Javob:", "J:", "Ответ:" — not intermediate steps; keep the minus sign, the decimal comma or point and a fraction such as 3/4 as written.
Set "sure" to false when the writing is unclear, an answer is crossed out without a clear replacement, or you cannot tell which question an answer belongs to.
Leave out questions that are not on this page. Never work out an answer yourself.`;
}

/** The model's list → answers the sheet can take: in range, one per question (the last one written wins), kind checked by code. */
export function toAnswers(raw: z.infer<typeof OUTPUT>["answers"], kinds: ("choice" | "number")[]): ReadAnswer[] {
  const byQ = new Map<number, ReadAnswer>();
  for (const a of raw) {
    const q = a.n - 1;
    if (q < 0 || q >= kinds.length || !a.answer.trim()) continue;
    const c = canonical(a.answer);
    const fits = c !== null && /^[A-E]$/.test(c) === (kinds[q] === "choice");
    byQ.set(q, { q, raw: fits ? c! : a.answer.trim().slice(0, 20), unsure: !a.sure || !fits });
  }
  return [...byQ.values()].sort((a, b) => a.q - b.q);
}

let client: Anthropic | undefined;
function defaultCreate(): CreateMessage {
  client ??= new Anthropic({ apiKey: anthropicApiKey() });
  const c = client;
  return (p) => c.beta.messages.create(p);
}

export interface PhotoInput {
  centerId: string;
  image: Uint8Array;
  mediaType: PhotoMediaType;
  kinds: ("choice" | "number")[];
  /** injected model call (tests); default: the Anthropic API */
  create?: CreateMessage;
  now?: Date;
}

export interface ModelRead {
  answers: ReadAnswer[];
  usage: { inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number };
  failed: boolean;
}

/** The model call alone (no database): what the photo says, or failed. Also used by scripts/homework-photo-eval.ts. */
export async function readPhotoWithModel(p: { image: Uint8Array; mediaType: PhotoMediaType; kinds: ("choice" | "number")[]; create?: CreateMessage; model?: string }): Promise<ModelRead> {
  const model = p.model ?? homeworkPhotoModel();
  const none = { inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 };
  let res: Anthropic.Beta.BetaMessage;
  try {
    res = await (p.create ?? defaultCreate())({
      model,
      max_tokens: 8000,
      ...fallbackParams(model),
      output_config: { effort: "medium", format: { type: "json_schema", schema: SCHEMA as unknown as Record<string, unknown> } },
      system: SYSTEM,
      messages: [
        {
          role: "user",
          content: [
            { type: "image", source: { type: "base64", media_type: p.mediaType, data: Buffer.from(p.image).toString("base64") } },
            { type: "text", text: photoPrompt(p.kinds) },
          ],
        },
      ],
    });
  } catch (e) {
    console.error("homework photo: model call failed", e);
    return { answers: [], usage: none, failed: true };
  }
  const u = res.usage;
  const usage = { inputTokens: u.input_tokens, outputTokens: u.output_tokens, cacheReadTokens: u.cache_read_input_tokens ?? 0, cacheWriteTokens: u.cache_creation_input_tokens ?? 0 };
  if (res.stop_reason === "refusal" || res.stop_reason === "max_tokens") return { answers: [], usage, failed: true };
  try {
    const text = res.content.flatMap((b) => (b.type === "text" ? [b.text] : [])).join("");
    return { answers: toAnswers(OUTPUT.parse(JSON.parse(text)).answers, p.kinds), usage, failed: false };
  } catch {
    return { answers: [], usage, failed: true };
  }
}

/** Read one photo for a center. Metered into the center's monthly AI usage, refused above its cap. */
export async function readAnswersFromPhoto(p: PhotoInput): Promise<PhotoReadResult> {
  const center = await db.center.findUnique({ where: { id: p.centerId }, select: { settings: true, disabledAt: true } });
  if (!center || center.disabledAt) return { ok: false, reason: "off" };
  const settings = readSettings(center.settings);
  if (!settings.homework.photos || (!p.create && !anthropicApiKey())) return { ok: false, reason: "off" };
  const month = monthKey(todayISO(p.now ?? new Date()));
  const used = await db.agentUsage.findUnique({ where: { centerId_month: { centerId: p.centerId, month } } });
  if (used && capTokens(used) >= settings.agent.monthlyTokenCap) return { ok: false, reason: "limit" };

  const r = await readPhotoWithModel(p);
  if (r.usage.inputTokens + r.usage.outputTokens > 0) {
    await db.agentUsage.upsert({
      where: { centerId_month: { centerId: p.centerId, month } },
      create: { centerId: p.centerId, month, ...r.usage, calls: 1 },
      update: { ...Object.fromEntries(Object.entries(r.usage).map(([k, v]) => [k, { increment: v }])), calls: { increment: 1 } },
    });
  }
  if (r.failed) return { ok: false, reason: "failed" };
  return r.answers.length ? { ok: true, answers: r.answers } : { ok: false, reason: "nothing" };
}
