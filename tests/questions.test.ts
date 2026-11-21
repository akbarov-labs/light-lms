// Question bank end to end: a book read in overlapping chunks with the model replaced by a script, the
// keys decided by code, saved as drafts, re-runs that never read or pay twice, and the owner's review.
// Run: npm run test:integration
import { beforeAll, describe, expect, it } from "vitest";
import { PDFDocument } from "pdf-lib";
import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { UserError } from "@/lib/user-error";
import { importBook } from "@/lib/questions/import";
import type { CreateMessage } from "@/lib/questions/extract";
import { approveSure, bankOverview, editQuestion, saveImported, setQuestionStatus, topicQuestions, type ImportItem } from "@/lib/services/questions";

let centerId = "";
let otherCenterId = "";
let userId = "";
let book: Uint8Array;

const message = (body: unknown, stop: string = "end_turn") =>
  ({ id: "m", type: "message", role: "assistant", model: "x", content: [{ type: "text", text: JSON.stringify(body) }], stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 200 } }) as unknown as Anthropic.Beta.BetaMessage;

const q = (o: Record<string, unknown>) => ({ ref: "", options: ["1", "2", "3", "4"], stated: "", solution: "", figure: false, page: 1, answer: "", ...o });

/** What the "model" sees on each chunk of the 6-page book read 4 pages at a time: pages 1–4, then 4–6. */
const PAGES_1_4 = {
  sections: [{ code: "1", title: "Natural sonlar" }, { code: "1.1", title: "Qo'shish" }],
  questions: [
    q({ section: "1.1", number: 1, ref: "97-1-6", text: "2+2=?", stated: "B", answer: "B", solution: "2+2=4. Javob: 4 (B)", page: 1 }),
    q({ section: "1.1", number: 2, text: "5+7=?", options: [], answer: "12", page: 2 }),
    q({ section: "1.1", number: 3, text: "1+1=?", stated: "A", answer: "C", page: 3 }),
    q({ section: "1.1", number: 4, text: "Rasmdagi uchburchak yuzi?", figure: true, answer: "D", page: 4 }),
  ],
};
const PAGES_4_6 = {
  sections: [{ code: "1.2", title: "Ayirish" }],
  questions: [
    // the overlapping page again: not saved twice, not solved twice
    q({ section: "1.1", number: 4, text: "Rasmdagi uchburchak yuzi?", figure: true, answer: "D", page: 1 }),
    q({ section: "1.2", number: 1, text: "9-5=?", answer: "D", page: 2 }),
  ],
};

function scripted(extracts: unknown[], solves: (ids: string[]) => Record<string, string>) {
  const log: { kind: "extract" | "solve"; prompt: string; pages?: number; ids?: string[] }[] = [];
  const create: CreateMessage = async (p) => {
    const content = p.messages[0].content;
    if (Array.isArray(content) && content[0].type === "document") {
      const src = (content[0] as { source: { data: string } }).source;
      const pages = (await PDFDocument.load(Buffer.from(src.data, "base64"))).getPageCount();
      log.push({ kind: "extract", prompt: (content[1] as { text: string }).text, pages });
      return message(extracts.shift() ?? { sections: [], questions: [] });
    }
    const prompt = String(content);
    const ids = [...prompt.matchAll(/^\[(\d+)\]/gm)].map((m) => m[1]);
    log.push({ kind: "solve", prompt, ids });
    const got = solves(ids);
    return message({ answers: ids.map((id) => ({ id, answer: got[id] ?? "" })) });
  };
  return { create, log };
}

beforeAll(async () => {
  centerId = (await db.center.create({ data: { name: "Savol markazi", slug: "questions-test" } })).id;
  otherCenterId = (await db.center.create({ data: { name: "Boshqa markaz", slug: "questions-other" } })).id;
  userId = (await db.user.create({ data: { centerId, phone: "998937770301", name: "Ega", passwordHash: "x", role: "OWNER", perms: [] } })).id;
  const doc = await PDFDocument.create();
  for (let i = 0; i < 6; i++) doc.addPage([200, 200]);
  book = await doc.save();
});

describe("reading a book", () => {
  it("reads overlapping chunks, solves each new question once more, and saves drafts with code-decided keys", async () => {
    // second solve: 1.1#1 B (agrees), 1.1#2 12 (agrees), 1.1#3 C, 1.1#4 D; then 1.2#1 C (disagrees)
    const answers: Record<string, string>[] = [{ "0": "B", "1": "12", "2": "C", "3": "D" }, { "0": "C" }];
    const s = scripted([PAGES_1_4, PAGES_4_6], () => answers.shift()!);
    const r = await importBook({ centerId, pdf: book, chunk: 4, model: "m", create: s.create });

    expect(s.log.map((l) => `${l.kind}${l.pages ?? ""}:${l.ids?.length ?? ""}`)).toEqual(["extract4:", "solve:4", "extract3:", "solve:1"]);
    // the second chunk starts inside the section the first one ended in
    expect(s.log[2].prompt).toContain(`section 1.1 "Qo'shish"`);
    expect(r).toMatchObject({ pages: 6, read: 5, created: 5, skipped: 0, failed: [] });
    expect(r.keyChecks).toEqual({ STATED: 1, AGREED: 1, CONFLICT: 2, UNKNOWN: 1 });
    expect(r.usage).toEqual({ inputTokens: 4000, outputTokens: 800 });

    const topics = await db.questionTopic.findMany({ where: { centerId }, orderBy: { code: "asc" } });
    expect(topics.map((t) => `${t.code} ${t.title}`)).toEqual(["1 Natural sonlar", "1.1 Qo'shish", "1.2 Ayirish"]);
    const all = await db.question.findMany({ where: { centerId }, include: { topic: true } });
    const by = (code: string, n: number) => all.find((x) => x.topic.code === code && x.number === n)!;
    expect(by("1.1", 1)).toMatchObject({ answer: "B", keyCheck: "STATED", statedAnswer: "B", solves: ["B", "B"], sourceRef: "97-1-6", page: 1, status: "DRAFT", source: "BOOK" });
    expect(by("1.1", 2)).toMatchObject({ answer: "12", keyCheck: "AGREED", options: [] });
    expect(by("1.1", 3)).toMatchObject({ answer: "A", keyCheck: "CONFLICT" });
    expect(by("1.1", 4)).toMatchObject({ answer: "", keyCheck: "UNKNOWN", needsFigure: true, page: 4 });
    expect(by("1.2", 1)).toMatchObject({ answer: "", keyCheck: "CONFLICT", solves: ["D", "C"], page: 5 });
  });

  it("a run again reads the pages but never solves or saves a question twice", async () => {
    const s = scripted([PAGES_1_4, PAGES_4_6], () => ({}));
    const r = await importBook({ centerId, pdf: book, chunk: 4, model: "m", create: s.create });
    expect(s.log.filter((l) => l.kind === "solve")).toEqual([]);
    expect(r).toMatchObject({ read: 0, created: 0 });
    expect(await db.question.count({ where: { centerId } })).toBe(5);
  });

  it("a chunk too long for one answer is read in two parts; a page that fails is reported", async () => {
    let call = 0;
    const create: CreateMessage = async () => {
      call++;
      if (call === 1) return message({}, "max_tokens");
      if (call === 2) return message({ sections: [], questions: [q({ section: "2.1", number: 1, text: "3·3=?", answer: "A", page: 1 })] });
      if (call === 3) return message({ answers: [{ id: "0", answer: "A" }] });
      return message({}, "refusal");
    };
    const r = await importBook({ centerId, pdf: book, from: 5, to: 6, chunk: 4, model: "m", create, dryRun: true });
    // pages 5–6 → too long → page 5 (one question), page 6 (refused)
    expect(r.read).toBe(1);
    expect(r.failed).toEqual([[6, 6]]);
    expect(r.created).toBe(0);
    expect(await db.question.count({ where: { centerId, topic: { code: "2.1" } } })).toBe(0);
  });
});

describe("the owner's review", () => {
  const me = () => ({ centerId, userId });
  const qid = async (code: string, n: number) => (await db.question.findFirst({ where: { centerId, number: n, topic: { code } } }))!.id;

  it("shows counts per topic, with the topics under it", async () => {
    const rows = await bankOverview(centerId);
    expect(rows.map((r) => [r.code, r.depth, r.total, r.sure, r.check])).toEqual([
      ["1", 0, 5, 2, 3],
      ["1.1", 1, 4, 2, 2],
      ["1.2", 1, 1, 0, 1],
    ]);
  });

  it("approves only the sure keys in one press", async () => {
    const top = await db.questionTopic.findFirstOrThrow({ where: { centerId, code: "1" } });
    expect(await approveSure(me(), top.id)).toBe(2);
    const approved = await db.question.findMany({ where: { centerId, status: "APPROVED" } });
    expect(approved.map((x) => x.answer).sort()).toEqual(["12", "B"]);
    expect(approved.every((x) => x.reviewedById === userId && x.reviewedAt)).toBe(true);
    expect(await approveSure(me(), top.id)).toBe(0);
  });

  it("a question without a key cannot be approved until a person sets one", async () => {
    const id = await qid("1.2", 1);
    await expect(setQuestionStatus(me(), id, "APPROVED")).rejects.toThrow(UserError);
    await expect(editQuestion(me(), id, { answer: "E" })).rejects.toThrow(UserError);
    await editQuestion(me(), id, { answer: "c" });
    await setQuestionStatus(me(), id, "APPROVED");
    expect(await db.question.findUniqueOrThrow({ where: { id } })).toMatchObject({ answer: "C", status: "APPROVED" });
  });

  it("an edit sends an approved question back for review; a key that no longer fits is dropped", async () => {
    const id = await qid("1.1", 1);
    await editQuestion(me(), id, { text: "2 + 2 = ?" });
    expect(await db.question.findUniqueOrThrow({ where: { id } })).toMatchObject({ text: "2 + 2 = ?", status: "DRAFT", answer: "B" });
    await editQuestion(me(), id, { options: [] });
    expect(await db.question.findUniqueOrThrow({ where: { id } })).toMatchObject({ options: [], answer: "" });
    await expect(editQuestion(me(), id, { options: ["only"] })).rejects.toThrow(UserError);
    await expect(editQuestion(me(), id, { text: "  " })).rejects.toThrow(UserError);
    await editQuestion(me(), id, { options: ["3", "4", "5"], answer: "B" });
    await setQuestionStatus(me(), id, "APPROVED");
  });

  it("rejects, and lists one filter at a time", async () => {
    const id = await qid("1.1", 3);
    await setQuestionStatus(me(), id, "REJECTED");
    const top = await db.questionTopic.findFirstOrThrow({ where: { centerId, code: "1" } });
    const v = (await topicQuestions(centerId, top.id, "check"))!;
    expect(v.counts).toEqual({ check: 1, sure: 0, approved: 3, rejected: 1, all: 5 });
    expect(v.questions.map((x) => `${x.topic.code}#${x.number}`)).toEqual(["1.1#4"]);
    expect(v.subtopics.map((s) => s.code)).toEqual(["1.1", "1.2"]);
    const approved = (await topicQuestions(centerId, top.id, "approved"))!;
    expect(approved.questions.map((x) => `${x.topic.code}#${x.number}`)).toEqual(["1.1#1", "1.1#2", "1.2#1"]);
  });

  it("another center cannot see or touch the bank", async () => {
    const top = await db.questionTopic.findFirstOrThrow({ where: { centerId, code: "1" } });
    const other = { centerId: otherCenterId, userId };
    expect(await topicQuestions(otherCenterId, top.id, "all")).toBeNull();
    expect(await bankOverview(otherCenterId)).toEqual([]);
    await expect(setQuestionStatus(other, await qid("1.1", 4), "REJECTED")).rejects.toThrow(UserError);
    await expect(approveSure(other, top.id)).rejects.toThrow(UserError);
  });
});

describe("a whole book in one load", () => {
  // 2,742 questions in one transaction ran past the 5 s limit on production (about 6 ms a query there):
  // topics go first, questions in batches, so the size of a book no longer matters
  const topics = Array.from({ length: 12 }, (_, i) => ({ code: `7.${i + 1}`, title: `Mavzu ${i + 1}`, theory: `${i + 1}-qoida: $a^${i + 1}$` }));
  const items: ImportItem[] = topics.flatMap((t) =>
    Array.from({ length: 110 }, (_, n) => ({
      q: { section: t.code, number: n + 1, ref: null, text: `${t.code} · ${n + 1}-savol`, options: ["1", "2", "3", "4"], stated: "B", solution: null, figure: false, page: 1, solve: "B" },
      solve2: "B",
    })),
  );
  let bigCenterId = "";

  beforeAll(async () => {
    bigCenterId = (await db.center.create({ data: { name: "Katta kitob", slug: "questions-big" } })).id;
  });

  it("saves every question and every explanation, then a run again changes nothing a person touched", async () => {
    const first = await saveImported(bigCenterId, [{ code: "7", title: "Bob" }, ...topics], items);
    expect(first).toEqual({ created: 1320, skipped: 0 });
    expect(await db.question.count({ where: { centerId: bigCenterId, keyCheck: "STATED" } })).toBe(1320);
    expect(await db.questionTopic.count({ where: { centerId: bigCenterId, theory: { not: null } } })).toBe(12);

    const one = await db.question.findFirstOrThrow({ where: { centerId: bigCenterId, number: 5 }, include: { topic: true } });
    await db.question.update({ where: { id: one.id }, data: { text: "egasi tuzatdi" } });
    await db.questionTopic.update({ where: { id: one.topicId }, data: { theory: "egasining tushuntirishi" } });

    const again = await saveImported(bigCenterId, topics, items);
    expect(again).toEqual({ created: 0, skipped: 1320 });
    expect((await db.question.findUniqueOrThrow({ where: { id: one.id } })).text).toBe("egasi tuzatdi");
    expect((await db.questionTopic.findUniqueOrThrow({ where: { id: one.topicId } })).theory).toBe("egasining tushuntirishi");
    expect(await db.question.count({ where: { centerId: bigCenterId } })).toBe(1320);
  });
});
