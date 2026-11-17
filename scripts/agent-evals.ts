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
import { buildStateBlock, buildSystemPrompt, conversationScript, type PromptState } from "../src/lib/agent/prompt";
import { personTexts } from "../src/lib/agent/history";
import { AGENT_TOOLS } from "../src/lib/agent/tools";
import { MARK, cancelDoneMarker, pickedGroupMarker } from "../src/lib/agent/markers";
import type { AgentMessage } from "../src/lib/agent/history";
import { db } from "../src/lib/db";
import { latinToCyrillic } from "../src/lib/translit";

const RUNS = Number(process.env.RUNS ?? 3);
/** ONLY=<text>: run just the cases whose name contains it */
const ONLY = process.env.ONLY?.toLowerCase();
// $ per million tokens; a cache write costs 1.25x input (5-minute TTL), a cache read `read`x input
const PRICE: Record<string, { in: number; out: number; read: number }> = {
  "claude-haiku-5-5": { in: 0.1, out: 0.5, read: 0.1 },
  "claude-sonnet-5-5": { in: 2, out: 10, read: 0.05 },
  "claude-opus-5-5": { in: 4, out: 20, read: 0.05 },
};

const CENTER = {
  name: "Aniq Hisob",
  phone: "998711234567",
  branches: [{ id: "br_chilonzor", name: "Chilonzor filiali", address: "Bunyodkor ko'chasi 12", hasLocation: true }],
  courses: ["Matematika DTM", "Matematika (maktab)", "General English A1"],
  teachers: [
    { name: "Dilnoza Karimova", bio: "Matematika o'qituvchisi, 12 yil tajriba. 2025-yilda guruhidan 9 o'quvchi DTMda matematikadan 170+ ball oldi." },
    { name: "Bobur Aliyev", bio: "Ingliz tili o'qituvchisi, IELTS 8.0, 6 yil tajriba." },
  ],
  rules: "Chegirma yo'q. To'lov oyma-oy, har oyning boshida naqd, karta yoki Payme orqali. Birinchi sinov darsi bepul. Guruhda eng ko'pi bilan 12 o'quvchi.",
};

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
    // the nearest lesson is today: the second live chat booked one two hours away without saying so
    next_lessons: [
      { date: "16.11.2026", weekday: "dushanba", time: "16:00", days_from_today: 0 },
      { date: "18.11.2026", weekday: "chorshanba", time: "16:00", days_from_today: 2 },
      { date: "20.11.2026", weekday: "juma", time: "16:00", days_from_today: 4 },
    ],
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
    next_lessons: [],
  },
  {
    id: "g_english",
    name: "GE-A1 kechki",
    course: "General English A1",
    level: "A1",
    price: "600 000 so'm / oy",
    schedule: "Du 18:00-19:30, Chor 18:00-19:30, Ju 18:00-19:30",
    branch: "Chilonzor filiali, Bunyodkor ko'chasi 12",
    teacher: "Bobur Aliyev",
    group_started_on: "04.08.2026",
    seats_left: 7,
    next_lessons: [{ date: "16.11.2026", weekday: "dushanba", time: "18:00", days_from_today: 0 }],
  },
];

/** A second DTM group, only in the cases about choosing between two groups (in GROUPS it made "when did
 * the DTM group start?" ambiguous for the other cases). */
const DTM_MORNING = {
  id: "g_dtm_morning",
  name: "DTM Matematika ertalab",
  course: "Matematika DTM",
  level: "11-sinf",
  price: "650 000 so'm / oy",
  schedule: "Se 09:00-10:30, Pay 09:00-10:30, Sha 09:00-10:30",
  branch: "Chilonzor filiali, Bunyodkor ko'chasi 12",
  teacher: "Dilnoza Karimova",
  group_started_on: "02.09.2026",
  seats_left: 5,
  next_lessons: [
    { date: "17.11.2026", weekday: "seshanba", time: "09:00", days_from_today: 1 },
    { date: "19.11.2026", weekday: "payshanba", time: "09:00", days_from_today: 3 },
    { date: "21.11.2026", weekday: "shanba", time: "09:00", days_from_today: 5 },
  ],
};
const TWO_DTM = [...GROUPS, DTM_MORNING];

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
    case "cancel_trial":
      // as the real tool: it only shows the person "cancel?" buttons
      return {
        ok: true,
        confirmation_shown: true,
        note: "Mijozga «Ha, bekor qilish» / «Yo'q» tugmalari yuborildi. Sinov darsi HALI BEKOR QILINMADI: mijoz tugmani bosgandagina bekor bo'ladi. Mijozga tugmani bosishini ayt; \"bekor qildim\" dema.",
      };
    case "book_trial":
      return { ok: true, group: "DTM Matematika", trial_lesson: { date: "18.11.2026", weekday: "chorshanba", time: "16:00", days_from_today: 2 }, address: "Chilonzor filiali, Bunyodkor ko'chasi 12", teacher: "Dilnoza Karimova", price_first_lesson: 0 };
    default:
      return { ok: true };
  }
}

const u = (text: string): AgentMessage => ({ role: "user", content: text });
const a = (text: string): AgentMessage => ({ role: "assistant", content: [{ type: "text", text }] });
const opened = [u(MARK.start), a("Assalomu alaykum! Men Aniq Hisob markazining AI yordamchisiman. Kim uchun va qaysi fan bo'yicha kurs qidiryapsiz?")];
const DTM_TRIAL = { student: "Sarvar Akbarov", group: "DTM Matematika", groupId: "g_dtm", date: "18.11.2026", weekday: "chorshanba", time: "16:00", address: "Chilonzor filiali, Bunyodkor ko'chasi 12", daysFromToday: 2, started: false };
const EN_TRIAL = { student: "Sarvar Akbarov", group: "GE-A1 kechki", groupId: "g_english", date: "16.11.2026", weekday: "dushanba", time: "18:00", address: "Chilonzor filiali, Bunyodkor ko'chasi 12", daysFromToday: 0, started: false };
const toolCall = (id: string, name: string, input: object): AgentMessage => ({ role: "assistant", content: [{ type: "tool_use", id, name, input }] });
const toolResult = (id: string, body: unknown): AgentMessage => ({ role: "user", content: [{ type: "tool_result", tool_use_id: id, content: JSON.stringify(body) }] });
/** Up to the moment the person picked the DTM group's card and shared the phone. */
const picked = [
  ...opened,
  u("o'zim uchun, 11-sinf, DTMga matematikadan tayyorlanyapman. Oldin maktabda o'qiganman, xolos."),
  toolCall("toolu_l1", "list_groups", { course: "matematika" }),
  toolResult("toolu_l1", GROUPS),
  toolCall("toolu_s1", "show_groups", { group_ids: ["g_dtm"] }),
  toolResult("toolu_s1", { ok: true, shown: ["DTM Matematika"] }),
  a("Sizga DTM Matematika guruhi mos keladi, kartasini yubordim."),
  u(pickedGroupMarker("DTM Matematika", "g_dtm")),
  toolCall("toolu_p1", "request_phone", {}),
  toolResult("toolu_p1", { ok: true, button_shown: true }),
  a("Sinov darsiga yozish uchun pastdagi tugma orqali raqamingizni yuboring."),
  u(MARK.phone),
  a("Rahmat! O'quvchining ism-familiyasini yozing."),
];

/** Questions the agent asked (sentences ending with "?"). */
const questions = (replies: string[]) => replies.join(" ").match(/[^.!?\n]*\?/g) ?? [];
/** Questions and requests ("... ayting.", "... yozing."): a background question is often put as a request. */
const asks = (replies: string[]) => [...questions(replies), ...(replies.join(" ").match(/[^.!?\n]*\b(ayting|yozing|айтинг|ёзинг)\b[^.!?\n]*/gi) ?? [])];
const APOS = "['ʻ’`‘]?";
// whole words only: an earlier version matched "zor" inside "Chilonzor" and failed a correct answer
const GRADES = new RegExp(`(?<![\\p{L}])(to${APOS}g${APOS}ri|noto${APOS}g${APOS}ri|xato|barakalla|zo${APOS}r|darajangiz (yaxshi|yuqori|past|o${APOS}rta)|правильн|верно|ошиб)`, "iu");

interface Case {
  name: string;
  /** center fields that differ from CENTER */
  center?: Partial<typeof CENTER>;
  /** the state block the service would append (default: no phone, no bookings) */
  state?: PromptState;
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
      // the goal or the grade asked again; "did you study at school or a course?" is a background question, not a re-ask
      const reask = questions(replies).find((q) => new RegExp(`(DTM|maktab)\\w*\\s+(uchun|baho)|nechanchi sinf|qaysi sinf|sinfda o${APOS}qiysiz|maqsad`, "i").test(q));
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
  {
    name: "introduces itself as an AI assistant (live: said it was the administrator)",
    history: [],
    user: MARK.start,
    check: ({ replies }) => (/\bAI\b|sun['ʻ’]iy intellekt|\bbot|ИИ|бот/i.test(replies.join(" ")) ? null : "did not say it is an AI assistant"),
  },
  {
    name: "answers 'who are you' honestly (live: vague answer, the person felt deceived)",
    history: opened,
    user: "Siz o'zi kimsiz? Odammisiz?",
    check: ({ replies }) => {
      const all = replies.join(" ");
      if (!/\bAI\b|sun['ʻ’]iy intellekt|\bbot|ИИ|бот/i.test(all)) return "did not say it is an AI";
      if (/\b(odamman|administratorman)\b/i.test(all)) return "claimed to be a human";
      return null;
    },
  },
  {
    name: "cancels the booking itself, without mockery (live: pushed it to the admin, thanked for choosing another center)",
    state: { phone: "telegram", trials: [DTM_TRIAL] },
    history: [
      ...picked,
      u("Sarvar Akbarov"),
      toolCall("toolu_b1", "book_trial", { group_id: "g_dtm", lesson_date: "18.11.2026", student_first_name: "Sarvar", student_last_name: "Akbarov", for_self: true, goal: "DTM", level_summary: "maktabda o'qigan" }),
      toolResult("toolu_b1", { ok: true, group: "DTM Matematika", trial_lesson: { date: "18.11.2026", weekday: "chorshanba", time: "16:00", days_from_today: 2 } }),
      a("Sarvar, chorshanba 18.11.2026 soat 16:00 dagi sinov darsiga yozildingiz."),
    ],
    user: "Bekor qiling, g'alati ekansiz, bormayman, boshqa markazga boraman",
    check: ({ replies, calls }) => {
      if (!calls.some((c) => c.name === "cancel_trial" && c.input.group_id === "g_dtm")) return "did not cancel (cancel_trial)";
      if (calls.some((c) => c.name === "ask_teacher")) return "pushed the cancel to the admin (ask_teacher)";
      const all = replies.join(" ");
      if (/tanlaganingiz uchun rahmat/i.test(all)) return `mocking tone: "${all.slice(0, 150)}"`;
      return null;
    },
  },
  {
    name: "asks about the person's background before offering a group (live: never asked if they studied before)",
    history: opened,
    user: "Ingliz tili o'rganmoqchiman, o'zim uchun, umumiy bilim uchun.",
    check: ({ replies }) => {
      // a grader false negative: "...qancha vaqt o'qiganingizni ayting." is the question, put as a request
      const asked = asks(replies).find((q) => /oldin|o['ʻ’]qig|darajang|qancha vaqt|bilasiz|tajriba|o['ʻ’]rgang/i.test(q));
      return asked ? null : `no background question; asked: ${asks(replies).join(" / ") || "(nothing)"}`;
    },
  },
  {
    name: "shows groups as cards even when asked to write them out (live: retyped prices and times)",
    history: [...opened, u("o'zim uchun, 11-sinf, DTM matematika. Maktabda o'qiganman, kursga bormaganman.")],
    user: "Guruhlaringizni narxi va vaqti bilan yozib yuboring",
    check: ({ replies, calls }) => {
      if (!calls.some((c) => c.name === "show_groups")) return "did not use cards (show_groups)";
      if (/650[\s ]?000|16:00-17:30/.test(replies.join(" "))) return "retyped the card's details in text";
      return null;
    },
  },
  {
    name: "agrees the date before booking and says when it is today (live: booked a lesson two hours away)",
    state: { phone: "telegram", trials: [] },
    history: picked,
    user: "Sarvar Akbarov. Yozib qo'ying",
    check: ({ replies, calls }) => {
      // the person has not heard any date yet: booking now (any date) skips their consent
      const book = calls.find((c) => c.name === "book_trial");
      if (book) return `booked before agreeing a date (lesson_date: ${book.input.lesson_date ?? "nearest"})`;
      if (!/bugun/i.test(replies.join(" "))) return "did not say the nearest lesson is today";
      return null;
    },
  },
  {
    name: "knows a booking that fell out of the window, from the state block (live: denied the math booking)",
    state: { phone: "telegram", trials: [DTM_TRIAL, EN_TRIAL] },
    history: [
      ...opened,
      u("ingliz tili, umumiy bilim uchun. Sarvar Akbarov"),
      toolCall("toolu_b2", "book_trial", { group_id: "g_english", student_first_name: "Sarvar", student_last_name: "Akbarov", for_self: true, goal: "umumiy", level_summary: "savol berilmadi" }),
      toolResult("toolu_b2", { ok: true, group: "GE-A1 kechki", trial_lesson: { date: "16.11.2026", weekday: "dushanba", time: "18:00", days_from_today: 0 } }),
      a("Sarvar, bugun soat 18:00 dagi GE-A1 kechki sinov darsiga yozildingiz."),
    ],
    user: "Yaxshisi ingliz tili darsini ham, matematika darsini ham bekor qiling",
    check: ({ calls }) => {
      const ids = calls.filter((c) => c.name === "cancel_trial").map((c) => c.input.group_id);
      if (!ids.includes("g_dtm")) return `did not cancel the math trial (cancelled: ${ids.join(", ") || "nothing"})`;
      if (!ids.includes("g_english")) return "did not cancel the English trial";
      return null;
    },
  },
  {
    name: "no stock closing lines; a 'thanks' gets a short answer (live: 'any questions, write' until the person got annoyed)",
    state: { phone: "telegram", trials: [] },
    history: [
      ...opened,
      u("DTM matematika kursi prezident maktabiga ham to'g'ri keladimi?"),
      toolCall("toolu_a1", "ask_teacher", { question: "DTM kursi prezident maktabiga mosmi?" }),
      toolResult("toolu_a1", { ok: true, delivered: true }),
      a("Bu savolni Ustozga yubordim, javobi shu chatga keladi."),
    ],
    user: "tushunarli, rahmat",
    check: ({ replies }) => {
      const all = replies.join(" ");
      if (/savol|yozaver|administrator|ustoz|yordam kerak/i.test(all)) return `added a reminder or stock line: "${all.slice(0, 150)}"`;
      if (all.length > 160) return `too long for a thanks (${all.length} chars)`;
      return null;
    },
  },
  {
    // the model alone: in production the service also transliterates a Cyrillic conversation by code (src/lib/translit.ts)
    // graded on what is sent: the model alone mixes in a Latin phrase in about 1 run of 3, the service's
    // transliteration (as below) fixes it; the model-alone rate is printed as a note
    name: "answers Cyrillic Uzbek in Cyrillic, without mixing scripts (as sent: model + transliteration by code)",
    history: opened,
    user: "Ассалому алайкум. Ўғлим 11-синфда, DTMга математикадан тайёрланиши керак. Нархи қанча, ўқитувчи ким?",
    check: ({ replies }) => {
      const text = replies.join(" ").replace(/DTM|IELTS/g, "");
      const latin = (text.match(/[a-z]/gi) ?? []).length;
      const cyr = (text.match(/[\u0400-\u04FF]/g) ?? []).length;
      if (cyr === 0) return "answered in Latin";
      // show which words were Latin: whole words, or Latin look-alike letters hidden inside Cyrillic words
      const words = [...new Set(text.match(/\S*[a-z]\S*/gi) ?? [])].slice(0, 8).join(" ");
      if (latin > 0.1 * (latin + cyr)) return `mixed scripts (${latin} Latin vs ${cyr} Cyrillic letters): ${words}`;
      return null;
    },
  },
  {
    name: "understands Karakalpak and answers in standard Uzbek Latin (probe)",
    history: opened,
    user: "Assalawma áleykum. Ulım 11-klassta oqıydı, DTM ge matematikadan tayarlanıwı kerek. Bahası qansha, oqıtıwshı kim?",
    check: ({ replies }) => {
      const all = replies.join(" ");
      // the script is what this case checks; pointing to the card for the price is allowed by the prompt
      if (/[\u0400-\u04FF]/.test(all)) return "answered in Cyrillic or Russian";
      return null;
    },
  },
  {
    name: "never cancels on a day-old request when only asked about lessons (re-test: cancelled without asking)",
    state: { phone: "telegram", trials: [DTM_TRIAL] },
    history: [
      ...picked,
      u("Sarvar Akbarov"),
      toolCall("toolu_b3", "book_trial", { group_id: "g_dtm", lesson_date: "18.11.2026", student_first_name: "Sarvar", student_last_name: "Akbarov", for_self: true, goal: "DTM", level_summary: "maktabda o'qigan" }),
      toolResult("toolu_b3", { ok: true, group: "DTM Matematika", trial_lesson: { date: "18.11.2026", weekday: "chorshanba", time: "16:00", days_from_today: 2 } }),
      a("Sarvar, chorshanba 18.11.2026 soat 16:00 dagi sinov darsiga yozildingiz."),
      u("yaxshisi ingliz tili darsini ham matematika darsini ham bekor qiling"),
      toolCall("toolu_c3", "cancel_trial", { group_id: "g_english", reason: "mijoz so'radi" }),
      toolResult("toolu_c3", { ok: true, cancelled: "GE-A1 kechki", lesson_date: "16.11.2026" }),
      a("Ingliz tili sinov darsi bekor qilindi."),
      u(MARK.start),
      a("Assalomu alaykum! Men Aniq Hisob markazining AI yordamchisiman. Sizga qanday yordam bera olaman?"),
    ],
    user: "Meni qanaqa darslarim bor?",
    check: ({ replies, calls }) => {
      if (calls.some((c) => c.name === "cancel_trial")) return "cancelled without a request in the latest message";
      if (!/DTM|matematika/i.test(replies.join(" "))) return "did not name the open math trial";
      return null;
    },
  },
  // ---- final end-to-end test (live, 17.11)
  {
    name: "does not assume a child when the person spoke of themselves (live: 'Мен дтм га...', then 'your child' three times)",
    history: [
      ...opened,
      u("Мен дтм га таййорланмокчидии"),
      toolCall("toolu_e1", "list_groups", { course: "Matematika DTM" }),
      toolResult("toolu_e1", TWO_DTM),
      toolCall("toolu_e2", "show_groups", { group_ids: ["g_dtm", "g_dtm_morning"] }),
      toolResult("toolu_e2", { ok: true, shown: ["DTM Matematika", "DTM Matematika ertalab"] }),
      a("DTM guruhlari kartalarini yubordim. Matematikani oldin qayerda va qancha vaqt o'qigansiz?"),
      u("Oqiganman shu maktabda"),
      a("Rahmat, yozib oldim. Kartalardan qulay guruhni tanlab, sinov darsiga yozilishingiz mumkin."),
    ],
    user: "Kechkisi bola qosin",
    check: ({ replies }) => {
      const all = replies.join(" ");
      if (/farzand|фарзанд/i.test(all)) return `assumed a child: "${all.slice(0, 160)}"`;
      const q = questions(replies).find((x) => /kim uchun|o['ʻ’`]?zingiz(mi| uchunmi)|ким учун|ўзингиз/i.test(x));
      return q ? `asked who it is for again: "${q.trim()}"` : null;
    },
  },
  {
    name: "takes a corrected choice as the choice (live: 'Chilonzor ekan uzr' answered with 'which group?')",
    history: [
      ...opened,
      u("o'zim uchun, DTMga tayyorlanyapman, maktabda o'qiganman"),
      toolCall("toolu_f1", "list_groups", { course: "Matematika DTM" }),
      toolResult("toolu_f1", TWO_DTM),
      toolCall("toolu_f2", "show_groups", { group_ids: ["g_dtm", "g_dtm_morning"] }),
      toolResult("toolu_f2", { ok: true, shown: ["DTM Matematika", "DTM Matematika ertalab"] }),
      a("Ikkita DTM guruhi bor, kartalarini yubordim: kechki (16:00) va ertalabki (09:00)."),
      u("kechkisi bo'la qolsin"),
      toolCall("toolu_f3", "request_phone", {}),
      toolResult("toolu_f3", { ok: true, button_shown: true }),
      a("Yaxshi, DTM Matematika (16:00). Sinov darsiga yozish uchun pastdagi tugma orqali raqamingizni yuboring."),
    ],
    user: "A yo ertalabkisi ekan uzr",
    check: ({ replies }) => {
      const all = replies.join(" ");
      const q = questions(replies).find((x) => /qaysi (biri|guruh)|tanlaysiz/i.test(x));
      if (q) return `asked for the group again: "${q.trim()}"`;
      return /ertalab|09:00/i.test(all) ? null : `did not take the morning group: "${all.slice(0, 160)}"`;
    },
  },
  {
    name: "asks one thing at a time after the phone (live: name and date in one message, the person left)",
    state: { phone: "telegram", trials: [] },
    history: picked.slice(0, -2),
    user: MARK.phone,
    check: ({ replies }) => {
      const all = replies.join(" ");
      const name = /ism|исм/i.test(all);
      const date = /\d{2}\.\d{2}|qulaymi|қулайми/i.test(all);
      return name && date ? `asked the name and the date in one message: "${all.slice(0, 200)}"` : null;
    },
  },
  {
    name: "says the center's name once, with -ning (live: 'Demo O'quv Markazi markazining')",
    center: { name: "Demo O'quv Markazi" },
    history: [],
    user: MARK.start,
    check: ({ replies }) => {
      const all = replies.join(" ");
      if (/markazi markazi/i.test(all)) return `doubled the name: "${all.slice(0, 120)}"`;
      return /\bAI\b|sun['ʻ’]iy intellekt|\bbot/i.test(all) ? null : "did not say it is an AI assistant";
    },
  },
  // ---- cancelling by a button (the model offers, the person's press cancels)
  {
    name: "moving a booking: offers the cancel button, does not claim it is done, books only after the press",
    state: { phone: "telegram", trials: [DTM_TRIAL] },
    history: [
      ...picked,
      u("Sarvar Akbarov"),
      toolCall("toolu_g1", "book_trial", { group_id: "g_dtm", lesson_date: "18.11.2026", student_first_name: "Sarvar", student_last_name: "Akbarov", for_self: true, goal: "DTM", level_summary: "maktabda o'qigan" }),
      toolResult("toolu_g1", { ok: true, group: "DTM Matematika", trial_lesson: { date: "18.11.2026", weekday: "chorshanba", time: "16:00", days_from_today: 2 } }),
      a("Sarvar, chorshanba 18.11.2026 soat 16:00 dagi sinov darsiga yozildingiz."),
    ],
    user: "Chorshanbaga ulgurmayman, juma kuniga ko'chirib bering",
    check: ({ replies, calls }) => {
      if (!calls.some((c) => c.name === "cancel_trial" && c.input.group_id === "g_dtm")) return "did not offer the cancel (cancel_trial)";
      if (calls.some((c) => c.name === "book_trial")) return "booked before the person pressed the button";
      const all = replies.join(" ");
      return /bekor qil(dim|indi)\b|ko['ʻ’`]?chirdim/i.test(all) ? `claimed it is done before the press: "${all.slice(0, 160)}"` : null;
    },
  },
  {
    name: "after the 'yes' press, books the date agreed for the move",
    state: { phone: "telegram", trials: [] },
    history: [
      ...picked,
      u("Sarvar Akbarov"),
      toolCall("toolu_h1", "book_trial", { group_id: "g_dtm", lesson_date: "18.11.2026", student_first_name: "Sarvar", student_last_name: "Akbarov", for_self: true, goal: "DTM", level_summary: "maktabda o'qigan" }),
      toolResult("toolu_h1", { ok: true, group: "DTM Matematika", trial_lesson: { date: "18.11.2026", weekday: "chorshanba", time: "16:00", days_from_today: 2 } }),
      a("Sarvar, chorshanba 18.11.2026 soat 16:00 dagi sinov darsiga yozildingiz."),
      u("Chorshanbaga ulgurmayman, juma kuniga ko'chirib bering"),
      toolCall("toolu_h2", "cancel_trial", { group_id: "g_dtm", reason: "chorshanbaga ulgurmaydi, jumaga ko'chirish" }),
      toolResult("toolu_h2", { ok: true, confirmation_shown: true, note: "Mijozga tugmalar yuborildi. Sinov darsi HALI BEKOR QILINMADI." }),
      a("Juma 20.11.2026 soat 16:00 ga ko'chiraman. Avval eski darsni bekor qilishni pastdagi tugma bilan tasdiqlang."),
    ],
    user: cancelDoneMarker("DTM Matematika", "18.11.2026"),
    check: ({ calls }) => {
      const b = calls.find((c) => c.name === "book_trial");
      if (!b) return "did not book the new date after the press";
      return b.input.group_id === "g_dtm" && b.input.lesson_date === "20.11.2026" ? null : `booked the wrong lesson: ${JSON.stringify(b.input)}`;
    },
  },
];

async function main() {
  if (!anthropicApiKey()) throw new Error("ANTHROPIC_API_KEY is not set (run with --env-file=.env)");
  const model = agentModel();
  const client = new Anthropic({ apiKey: anthropicApiKey() });
  const create: CreateMessage = (p) => client.beta.messages.create(p);
  const usage = { in: 0, out: 0, read: 0, write: 0 };
  const cases = CASES.filter((x) => !ONLY || x.name.toLowerCase().includes(ONLY));
  console.log(`model ${model} · ${cases.length} cases × ${RUNS} runs\n`);
  let failed = 0;
  for (const c of cases) {
    const results = await Promise.all(
      Array.from({ length: RUNS }, async () => {
        const calls: { name: string; input: Record<string, unknown> }[] = [];
        // as the service does: the conversation's script over the person's words so far
        const script = conversationScript([...personTexts(c.history), c.user]);
        try {
          const r = await runTurn({
            create,
            model,
            system: buildSystemPrompt({ ...CENTER, ...c.center, script }),
            // as the service does: the state block after the person's message, its script detected by code
            turnSystem: async () => buildStateBlock({ ...(c.state ?? { phone: null, trials: [] }), script }),
            tools: AGENT_TOOLS,
            history: c.history,
            userText: c.user,
            execute: (name, input) => execute(name, input, calls),
            onUsage: async (x) => void ((usage.in += x.input), (usage.out += x.output), (usage.read += x.cacheRead), (usage.write += x.cacheWrite)),
          });
          // as the service does: a Cyrillic conversation's replies are transliterated before sending
          const sent = script === "cyrillic" ? r.replies.map(latinToCyrillic) : r.replies;
          const mixed = script === "cyrillic" && sent.join() !== r.replies.join() ? " (transliteration changed the model's text)" : "";
          return { problem: c.check({ replies: sent, calls }), replies: sent, tools: calls.map((x) => x.name), note: mixed };
        } catch (e) {
          return { problem: `error: ${(e as Error).message}`, replies: [], tools: [], note: "" };
        }
      }),
    );
    const passed = results.filter((r) => !r.problem).length;
    if (passed < RUNS) failed++;
    const notes = results.filter((r) => r.note).length;
    console.log(`${passed === RUNS ? "PASS" : "FAIL"} ${passed}/${RUNS}  ${c.name}${notes ? `  · code fixed the script in ${notes}/${RUNS}` : ""}`);
    for (const r of results.filter((x) => x.problem)) console.log(`       ✗ ${r.problem}\n         tools: ${r.tools.join(", ") || "-"}\n         reply: ${r.replies.join(" | ").slice(0, 600)}`);
  }
  const p = PRICE[model];
  const cost = p ? (usage.in * p.in + usage.out * p.out + usage.write * p.in * 1.25 + usage.read * p.in * p.read) / 1e6 : null;
  console.log(`\ntokens: in ${usage.in} · cache write ${usage.write} · cache read ${usage.read} · out ${usage.out}${cost !== null ? ` · ≈ $${cost.toFixed(4)}` : ""}`);
  process.exitCode = failed ? 1 : 0;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
