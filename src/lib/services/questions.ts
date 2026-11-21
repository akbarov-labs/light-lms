// The center's question bank: questions read from its own book (scripts/import-questions.ts), later written
// by the agent or by teachers. Nothing reaches a student before a person at the center approved it, with a
// key that fits its options. Pure key rules: lib/questions/keys.ts.
import { db } from "@/lib/db";
import { UserError } from "@/lib/user-error";
import { approvable, codeChain, compareCodes, decideKey, keyOf } from "@/lib/questions/keys";
import { MAX_THEORY, type BookSection, type ExtractedQuestion } from "@/lib/questions/extract";

// ------------------------------------------------------------------ import

export interface ImportItem {
  q: ExtractedQuestion;
  /** the second, independent solve */
  solve2: string | null;
}

/**
 * Saves a batch read from the book: topics (with the chapters above them) and new questions as drafts.
 * A question already in the bank (same topic and number) is left as it is, so a re-run never undoes a
 * person's review.
 */
export async function saveImported(centerId: string, sections: BookSection[], items: ImportItem[]): Promise<{ created: number; skipped: number }> {
  const titles = new Map(sections.map((s) => [s.code, s.title]));
  const theories = new Map(sections.flatMap((s) => (s.theory ? [[s.code, s.theory] as const] : [])));
  const codes = new Set<string>();
  for (const s of sections) codeChain(s.code).forEach((c) => codes.add(c));
  for (const i of items) codeChain(i.q.section).forEach((c) => codes.add(c));
  return db.$transaction(async (tx) => {
    const topicId = new Map<string, string>();
    for (const code of [...codes].sort(compareCodes)) {
      const title = titles.get(code);
      const t = await tx.questionTopic.upsert({
        where: { centerId_code: { centerId, code } },
        // a title read later replaces the code standing in for it
        update: title ? { title } : {},
        create: { centerId, code, title: title ?? code, theory: theories.get(code) ?? null },
      });
      // the book's explanation fills an empty one; it never overwrites what the owner edited
      const theory = theories.get(code);
      if (theory && !t.theory) await tx.questionTopic.update({ where: { id: t.id }, data: { theory } });
      topicId.set(code, t.id);
    }
    let created = 0;
    let skipped = 0;
    for (const { q, solve2 } of items) {
      const tid = topicId.get(q.section)!;
      const exists = await tx.question.findUnique({ where: { topicId_number: { topicId: tid, number: q.number } }, select: { id: true } });
      if (exists) {
        skipped++;
        continue;
      }
      const key = decideKey(q.stated, [q.solve, solve2], q.figure);
      await tx.question.create({
        data: {
          centerId,
          topicId: tid,
          number: q.number,
          text: q.text,
          options: q.options,
          answer: key.answer,
          keyCheck: key.keyCheck,
          statedAnswer: q.stated,
          solves: [q.solve ?? "", solve2 ?? ""],
          solution: q.solution,
          needsFigure: q.figure,
          source: "BOOK",
          sourceRef: q.ref,
          page: q.page,
        },
      });
      created++;
    }
    return { created, skipped };
  });
}

// ------------------------------------------------------------------ review

export interface Reviewer {
  centerId: string;
  userId: string;
}

async function own(r: Reviewer, id: string) {
  const q = await db.question.findFirst({ where: { id, centerId: r.centerId } });
  if (!q) throw new UserError("questions.notFound");
  return q;
}

/** "1) 16\n2) 10" or one per line → ["16", "10"]; letters and numbering a person typed are dropped. */
export function parseOptions(text: string): string[] {
  return text
    .split("\n")
    // "A) ", "b. ", "1) " — not "3:4" or "2.5", which are answers
    .map((l) => l.trim().replace(/^(?:[A-Ea-e]\s*[).:]|\d[).])\s+/, "").trim())
    .filter(Boolean);
}

export interface QuestionEdit {
  text?: string;
  options?: string[];
  answer?: string;
}

/** Fix what the book reading got wrong: the text, the options, the key. A changed question goes back to draft. */
/** The owner's correction of a topic's explanation; empty clears it. */
export async function editTopicTheory(r: Reviewer, topicId: string, theory: string): Promise<void> {
  const res = await db.questionTopic.updateMany({ where: { id: topicId, centerId: r.centerId }, data: { theory: theory.trim() ? theory.trim().slice(0, MAX_THEORY) : null } });
  if (res.count === 0) throw new UserError("error.notFound");
}

export async function editQuestion(r: Reviewer, id: string, e: QuestionEdit): Promise<void> {
  const q = await own(r, id);
  const options = e.options ?? q.options;
  if (options.length === 1 || options.length > 5) throw new UserError("questions.badOptions");
  let answer = q.answer;
  if (e.answer !== undefined) {
    if (e.answer.trim() === "") answer = "";
    else {
      const k = keyOf(e.answer, options.length);
      if (!k) throw new UserError("questions.badKey");
      answer = k;
    }
  } else if (answer && !keyOf(answer, options.length)) answer = "";
  const text = e.text?.trim() ?? q.text;
  if (!text) throw new UserError("questions.emptyText");
  await db.question.update({ where: { id }, data: { text, options, answer, status: q.status === "APPROVED" ? "DRAFT" : q.status, reviewedById: r.userId, reviewedAt: new Date() } });
}

export async function setQuestionStatus(r: Reviewer, id: string, status: "APPROVED" | "REJECTED" | "DRAFT"): Promise<void> {
  const q = await own(r, id);
  if (status === "APPROVED" && !approvable(q)) throw new UserError("questions.needKey");
  await db.question.update({ where: { id }, data: { status, reviewedById: r.userId, reviewedAt: new Date() } });
}

/**
 * Approve, in one press, the drafts of a topic (and the topics under it) whose key is sure: printed in the
 * book and confirmed by both solves, or found the same way twice. Questions with a picture, a disagreement
 * or no key stay for a person to look at one by one.
 */
export async function approveSure(r: Reviewer, topicId: string): Promise<number> {
  const topic = await db.questionTopic.findFirst({ where: { id: topicId, centerId: r.centerId } });
  if (!topic) throw new UserError("questions.notFound");
  const res = await db.question.updateMany({
    where: {
      centerId: r.centerId,
      status: "DRAFT",
      keyCheck: { in: ["STATED", "AGREED"] },
      needsFigure: false,
      answer: { not: "" },
      topic: { OR: [{ code: topic.code }, { code: { startsWith: `${topic.code}.` } }] },
    },
    data: { status: "APPROVED", reviewedById: r.userId, reviewedAt: new Date() },
  });
  return res.count;
}

// ------------------------------------------------------------------ reading

export interface TopicRow {
  id: string;
  code: string;
  title: string;
  depth: number;
  /** this topic and the ones under it */
  total: number;
  approved: number;
  sure: number;
  check: number;
  rejected: number;
}

/** Every topic in book order, with counts that include the topics under it. */
export async function bankOverview(centerId: string): Promise<TopicRow[]> {
  const [topics, counts] = await Promise.all([
    db.questionTopic.findMany({ where: { centerId }, select: { id: true, code: true, title: true } }),
    db.question.groupBy({ by: ["topicId", "status", "keyCheck"], where: { centerId }, _count: { _all: true } }),
  ]);
  const own = new Map<string, Omit<TopicRow, "id" | "code" | "title" | "depth">>();
  for (const c of counts) {
    const row = own.get(c.topicId) ?? { total: 0, approved: 0, sure: 0, check: 0, rejected: 0 };
    const n = c._count._all;
    row.total += n;
    if (c.status === "APPROVED") row.approved += n;
    else if (c.status === "REJECTED") row.rejected += n;
    else if (c.keyCheck === "STATED" || c.keyCheck === "AGREED") row.sure += n;
    else row.check += n;
    own.set(c.topicId, row);
  }
  const sorted = [...topics].sort((a, b) => compareCodes(a.code, b.code));
  return sorted.map((t) => {
    const sum = { total: 0, approved: 0, sure: 0, check: 0, rejected: 0 };
    for (const u of sorted) {
      if (u.code !== t.code && !u.code.startsWith(`${t.code}.`)) continue;
      const r = own.get(u.id);
      if (!r) continue;
      sum.total += r.total;
      sum.approved += r.approved;
      sum.sure += r.sure;
      sum.check += r.check;
      sum.rejected += r.rejected;
    }
    return { id: t.id, code: t.code, title: t.title, depth: t.code.split(".").length - 1, ...sum };
  });
}

export const FILTERS = ["check", "sure", "approved", "rejected", "all"] as const;
export type QuestionFilter = (typeof FILTERS)[number];

const filterWhere = (f: QuestionFilter) =>
  ({
    check: { status: "DRAFT" as const, keyCheck: { in: ["CONFLICT" as const, "UNKNOWN" as const] } },
    sure: { status: "DRAFT" as const, keyCheck: { in: ["STATED" as const, "AGREED" as const] } },
    approved: { status: "APPROVED" as const },
    rejected: { status: "REJECTED" as const },
    all: {},
  })[f];

export const TOPIC_PAGE = 200;

/** A topic's questions (with the topics under it) for review: one filter's list, the count of each filter, the topics just under it. */
export async function topicQuestions(centerId: string, topicId: string, filter: QuestionFilter) {
  const topic = await db.questionTopic.findFirst({ where: { id: topicId, centerId } });
  if (!topic) return null;
  const inTopic = { centerId, topic: { OR: [{ code: topic.code }, { code: { startsWith: `${topic.code}.` } }] } };
  const [questions, counts, under] = await Promise.all([
    db.question.findMany({ where: { ...inTopic, ...filterWhere(filter) }, include: { topic: { select: { code: true } } }, take: TOPIC_PAGE + 1 }),
    Promise.all(FILTERS.map((f) => db.question.count({ where: { ...inTopic, ...filterWhere(f) } }))),
    db.questionTopic.findMany({ where: { centerId, code: { startsWith: `${topic.code}.` } }, select: { id: true, code: true, title: true } }),
  ]);
  questions.sort((a, b) => compareCodes(a.topic.code, b.topic.code) || (a.number ?? 0) - (b.number ?? 0));
  const depth = topic.code.split(".").length + 1;
  return {
    topic,
    questions: questions.slice(0, TOPIC_PAGE),
    more: counts[FILTERS.indexOf(filter)] - Math.min(questions.length, TOPIC_PAGE),
    counts: Object.fromEntries(FILTERS.map((f, i) => [f, counts[i]])) as Record<QuestionFilter, number>,
    subtopics: under.filter((u) => u.code.split(".").length === depth).sort((a, b) => compareCodes(a.code, b.code)),
  };
}
