// Real-model evals for the lead agent's prompt and tool descriptions (the production ones, not agent-lab's).
// Tests in tests/agent.test.ts drive the code with a scripted model; these drive the real model with fake
// tool results, because the failures of the first live chats were the model's, not the code's.
// Each case starts mid-conversation (the moment that went wrong live) and is run RUNS times: a model
// passes a rate, not once. Graded by code (regex), so the grader costs nothing and never drifts.
//
//   npm run agent:evals            (RUNS=3 by default; costs about $0.02 on Haiku)
//   RUNS=5 AGENT_MODEL=claude-sonnet-5-5 npm run agent:evals
import Anthropic from "@anthropic-ai/sdk";
import { agentModel, anthropicApiKey } from "../src/lib/env";
import { runTurn, type CreateMessage } from "../src/lib/agent/loop";
import { buildSystemPrompt } from "../src/lib/agent/prompt";
import { AGENT_TOOLS } from "../src/lib/agent/tools";
import { MARK } from "../src/lib/agent/markers";
import type { AgentMessage } from "../src/lib/agent/history";
import { db } from "../src/lib/db";

const RUNS = Number(process.env.RUNS ?? 3);
/** ONLY=<text>: run just the cases whose name contains it */
const ONLY = process.env.ONLY?.toLowerCase();
const PRICE: Record<string, { in: number; out: number }> = {
  "claude-haiku-5-5": { in: 0.1, out: 0.5 },
  "claude-sonnet-5-5": { in: 2, out: 10 },
  "claude-opus-5-5": { in: 4, out: 20 },
};

const SYSTEM = buildSystemPrompt({
  name: "Aniq Hisob",
  phone: "998711234567",
  branches: [{ id: "br_chilonzor", name: "Chilonzor filiali", address: "Bunyodkor ko'chasi 12", hasLocation: true }],
  courses: ["Matematika DTM", "Matematika (maktab)"],
  teachers: [{ name: "Dilnoza Karimova", bio: "Matematika o'qituvchisi, 12 yil tajriba. 2025-yilda guruhidan 9 o'quvchi DTMda matematikadan 170+ ball oldi." }],
  rules: "Chegirma yo'q. To'lov oyma-oy, har oyning boshida naqd, karta yoki Payme orqali. Birinchi sinov darsi bepul. Guruhda eng ko'pi bilan 12 o'quvchi.",
});

const GROUPS = [
  {
    id: "g_dtm",
    name: "DTM Matematika",
    course: "Matematika DTM",
    level: "11-sinf",
    price: "650 000 so'm / oy",
    schedule: "Du 16:00-17:30, Chor 16:00-17:30, Ju 16:00-17:30",
    branch: "Chilonzor filiali, Bunyodkor ko'chasi 12",
    teacher: "Dilnoza Karimova",
    group_started_on: "21.08.2026",
    seats_left: 3,
    next_lesson: { date: "18.11.2026", weekday: "chorshanba", time: "16:00", days_from_today: 2 },
  },
  {
    id: "g_school",
    name: "Maktab matematikasi 7-9",
    course: "Matematika (maktab)",
    level: "7-9 sinf",
    price: "450 000 so'm / oy",
    schedule: "Se 15:00-16:30, Pay 15:00-16:30",
    branch: "Chilonzor filiali, Bunyodkor ko'chasi 12",
    teacher: "Dilnoza Karimova",
    group_starts_on: "01.12.2026",
    seats_left: 8,
    next_lesson: null,
  },
];

/** Fake tools: the same shapes the real ones return, no database. */
async function execute(name: string, input: Record<string, unknown>, calls: { name: string; input: Record<string, unknown> }[]): Promise<unknown> {
  calls.push({ name, input });
  switch (name) {
    case "list_groups":
      return GROUPS;
    case "show_groups":
      return { ok: true, shown: (input.group_ids as string[]).map((id) => GROUPS.find((g) => g.id === id)?.name ?? id), note: "Kartalar mijozga yuborildi. Ma'lumotni matnda takrorlama." };
    case "send_location":
      return { ok: true, sent: "Chilonzor filiali" };
    case "request_phone":
      return { ok: true, button_shown: true };
    case "ask_teacher":
      return { ok: true, delivered: true };
    default:
      return { ok: true };
  }
}

const u = (text: string): AgentMessage => ({ role: "user", content: text });
const a = (text: string): AgentMessage => ({ role: "assistant", content: [{ type: "text", text }] });
const opened = [u(MARK.start), a("Assalomu alaykum! Aniq Hisob markaziga xush kelibsiz. Kim uchun va qaysi fan bo'yicha kurs qidiryapsiz?")];

/** Questions the agent asked (sentences ending with "?"). */
const questions = (replies: string[]) => replies.join(" ").match(/[^.!?\n]*\?/g) ?? [];
const APOS = "['ʻ’`‘]?";
// whole words only: an earlier version matched "zor" inside "Chilonzor" and failed a correct answer
const GRADES = new RegExp(`(?<![\\p{L}])(to${APOS}g${APOS}ri|noto${APOS}g${APOS}ri|xato|barakalla|zo${APOS}r|darajangiz (yaxshi|yuqori|past|o${APOS}rta)|правильн|верно|ошиб)`, "iu");

interface Case {
  name: string;
  history: AgentMessage[];
  user: string;
  check: (r: { replies: string[]; calls: { name: string; input: Record<string, unknown> }[] }) => string | null;
}

const CASES: Case[] = [
  {
    name: "never grades level-check answers (live: 2x+6=14 → 5 was called correct)",
    history: [
      ...opened,
      u("o'zim uchun, 11-sinfdaman, DTMga matematikadan tayyorlanyapman"),
      a("Darajangizni bilish uchun 2 ta qisqa savol beraman. 1) 2x + 6 = 14 bo'lsa, x nechaga teng?"),
      u("5"),
      a("Rahmat, yozib oldim. 2) 3x − 5 = 10 bo'lsa, x nechaga teng?"),
    ],
    user: "8",
    check: ({ replies, calls }) => {
      const graded = replies.find((r) => GRADES.test(r));
      if (graded) return `graded the answers: "${graded.slice(0, 120)}"`;
      const book = calls.find((c) => c.name === "book_trial");
      if (book && !/5/.test(String(book.input.level_summary)) && !/8/.test(String(book.input.level_summary))) return `level_summary lost the raw answers: ${book.input.level_summary}`;
      return null;
    },
  },
  {
    name: "does not re-ask what was said (live: asked DTM or school after 'DTM')",
    history: opened,
    user: "Assalomu alaykum. 11-sinfda o'qiyman, DTMga matematikadan tayyorlanmoqchiman. Qanday guruhlar bor?",
    check: ({ replies, calls }) => {
      const reask = questions(replies).find((q) => /DTM|maktab|nechanchi sinf|sinfda|maqsad/i.test(q));
      if (reask) return `re-asked: "${reask.trim()}"`;
      if (!calls.some((c) => c.name === "show_groups")) return "did not show group cards (show_groups)";
      return null;
    },
  },
  {
    name: "answers about the teacher without asking for the phone (live: answers were tied to the phone)",
    history: [...opened, u("o'zim uchun, 11-sinf, DTM matematika"), a("Bizda DTM Matematika guruhi bor: dushanba, chorshanba, juma 16:00 da. Sizga mos keladimi?")],
    user: "O'qituvchi kim? Natijalari qanday?",
    check: ({ replies, calls }) => {
      const all = replies.join(" ");
      if (!/Dilnoza/.test(all)) return "did not name the teacher from the bio";
      if (!/170|9 o'quvchi|12 yil/.test(all)) return "did not use the bio's facts";
      if (calls.some((c) => c.name === "request_phone") || /raqam|telefon|номер/i.test(all)) return "asked for the phone";
      return null;
    },
  },
  {
    name: "says when the group started (live: 'no information' while the date was in the database)",
    history: [...opened, u("11-sinf, DTMga tayyorlanyapman")],
    user: "DTM guruhi qachon ochilgan? Hozir qo'shilsam ortda qolmaymanmi?",
    check: ({ replies, calls }) => {
      if (!calls.some((c) => c.name === "list_groups")) return "did not look the date up (list_groups)";
      if (!/21/.test(replies.join(" ")) || !/avgust|08/i.test(replies.join(" "))) return "did not give the start date 21.08.2026";
      return null;
    },
  },
  {
    name: "keeps helping after the phone is refused (live: asked three times)",
    history: [
      ...opened,
      u("o'zim uchun, 11-sinf, DTM"),
      a("DTM Matematika guruhimiz mos keladi. Sinov darsiga yozish uchun pastdagi tugma orqali raqamingizni yuboring."),
    ],
    user: "Hozir raqam bermayman. Avval ayting, narxi qancha?",
    check: ({ replies, calls }) => {
      if (calls.some((c) => c.name === "request_phone")) return "asked for the phone again (request_phone)";
      if (!/650/.test(replies.join(" "))) return "did not give the price";
      return null;
    },
  },
  {
    name: "sends the map when asked how to get there",
    history: [...opened, u("o'zim uchun, 11-sinf, DTM")],
    user: "Markaz qayerda joylashgan? Qanday boraman?",
    check: ({ calls }) => (calls.some((c) => c.name === "send_location" && c.input.branch_id === "br_chilonzor") ? null : "did not send the location"),
  },
];

async function main() {
  if (!anthropicApiKey()) throw new Error("ANTHROPIC_API_KEY is not set (run with --env-file=.env)");
  const model = agentModel();
  const client = new Anthropic({ apiKey: anthropicApiKey() });
  const create: CreateMessage = (p) => client.beta.messages.create(p);
  const usage = { in: 0, out: 0 };
  const cases = CASES.filter((x) => !ONLY || x.name.toLowerCase().includes(ONLY));
  console.log(`model ${model} · ${cases.length} cases × ${RUNS} runs\n`);
  let failed = 0;
  for (const c of cases) {
    const results = await Promise.all(
      Array.from({ length: RUNS }, async () => {
        const calls: { name: string; input: Record<string, unknown> }[] = [];
        try {
          const r = await runTurn({
            create,
            model,
            system: SYSTEM,
            tools: AGENT_TOOLS,
            history: c.history,
            userText: c.user,
            execute: (name, input) => execute(name, input, calls),
            onUsage: async (x) => void ((usage.in += x.input), (usage.out += x.output)),
          });
          return { problem: c.check({ replies: r.replies, calls }), replies: r.replies };
        } catch (e) {
          return { problem: `error: ${(e as Error).message}`, replies: [] };
        }
      }),
    );
    const passed = results.filter((r) => !r.problem).length;
    if (passed < RUNS) failed++;
    console.log(`${passed === RUNS ? "PASS" : "FAIL"} ${passed}/${RUNS}  ${c.name}`);
    for (const r of results.filter((x) => x.problem)) console.log(`       ✗ ${r.problem}\n         reply: ${r.replies.join(" | ").slice(0, 300)}`);
  }
  const p = PRICE[model];
  console.log(`\ntokens: in ${usage.in} · out ${usage.out}${p ? ` · ≈ $${((usage.in * p.in + usage.out * p.out) / 1e6).toFixed(4)}` : ""}`);
  process.exitCode = failed ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
