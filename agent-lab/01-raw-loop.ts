/**
 * 0-BOSQICH: qo'lda yozilgan agent sikli.
 *
 * Fayl ataylab framework'siz yozilgan. SDK'dan bitta funksiya ishlatiladi:
 * messages.create(). Qolgan hamma narsa (sikl, vositalarni bajarish, "xotira")
 * shu faylda, ko'z oldingizda turadi.
 *
 * Ssenariy: matematika markaziga yangi mijoz Telegram'da yozdi. Agent
 * administrator sifatida kutib oladi, darajani aniqlaydi, guruh topadi,
 * lead yaratadi, sinov darsiga yozadi va o'qituvchiga xabar beradi.
 *
 * Baza soxta (xotirada saqlanadi). 1-bosqichda xuddi shu vositalar haqiqiy
 * Prisma bazasiga ulanadi, agent sikli esa deyarli o'zgarmaydi.
 *
 * Ishga tushirish:  cd agent-lab && npm install && npm run 01
 */

import Anthropic from "@anthropic-ai/sdk";
import * as readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { pathToFileURL } from "node:url";

// ─────────────────────────────────────────────────────────────────────────────
// 1. SOXTA BAZA
//    Haqiqiy loyihada bu Prisma jadvallari bo'ladi (Group, Lead).
// ─────────────────────────────────────────────────────────────────────────────

type Group = {
  id: string;
  name: string;
  grade: string;
  days: string; // odamga ko'rsatish uchun
  weekdays: number[]; // kod uchun: 0 = yakshanba, 1 = dushanba ... 6 = shanba
  time: string;
  topic: string; // guruh hozir qaysi mavzuda
  freeSeats: number;
  priceUzs: number;
};

type Lead = {
  id: string;
  name: string;
  phone: string;
  grade: string;
  goal: string;
  levelSummary: string;
  trialGroupId?: string;
};

type Question = { id: string; leadId?: string; customerName: string; question: string };

export const GROUPS: Group[] = [
  { id: "g1", name: "5-6 sinf matematika", grade: "5-6", days: "Du, Chor, Ju", weekdays: [1, 3, 5], time: "15:00", topic: "Kasrlar", freeSeats: 3, priceUzs: 400_000 },
  { id: "g2", name: "7-8 sinf algebra", grade: "7-8", days: "Se, Pay, Sha", weekdays: [2, 4, 6], time: "15:00", topic: "Chiziqli tenglamalar", freeSeats: 0, priceUzs: 450_000 },
  { id: "g3", name: "7-8 sinf algebra (kechki)", grade: "7-8", days: "Du, Chor, Ju", weekdays: [1, 3, 5], time: "17:00", topic: "Ko'phadlar", freeSeats: 2, priceUzs: 450_000 },
  { id: "g4", name: "9-10 sinf algebra va geometriya", grade: "9-10", days: "Se, Pay, Sha", weekdays: [2, 4, 6], time: "17:00", topic: "Kvadrat tenglamalar", freeSeats: 4, priceUzs: 500_000 },
  { id: "g5", name: "Abituriyentlar (DTM, milliy sertifikat)", grade: "11", days: "Du-Sha", weekdays: [1, 2, 3, 4, 5, 6], time: "18:30", topic: "Test yechish strategiyasi", freeSeats: 5, priceUzs: 650_000 },
];
const INITIAL_SEATS = new Map(GROUPS.map((g) => [g.id, g.freeSeats]));

export const LEADS: Lead[] = [];
export const QUESTIONS: Question[] = []; // mijozlarning Ustozga savollari
export const TOOL_CALLS: string[] = []; // model so'ragan vositalar ketma-ketligi (evals uchun)

// ─────────────────────────────────────────────────────────────────────────────
// 2. VOSITALAR TAVSIFI (modelga yuboriladi)
//    Model kodni ko'rmaydi. U faqat nom, tavsif va parametrlar sxemasini ko'radi.
//    Shuning uchun "description" aslida vosita uchun yozilgan prompt:
//    QACHON chaqirish kerakligini ham shu yerda aytamiz.
// ─────────────────────────────────────────────────────────────────────────────

const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "list_groups",
    description:
      "Markazdagi guruhlar: sinf, kunlar, vaqt, hozirgi mavzu, bo'sh joylar soni va oylik narx (so'm). " +
      "Narx, jadval yoki bo'sh joy haqida gapirishdan OLDIN doim shu vositani chaqir. Bu ma'lumotlarni hech qachon o'zingdan aytma.",
    input_schema: {
      type: "object",
      properties: {
        grade: {
          type: "string",
          description: "Ixtiyoriy filtr: '5-6', '7-8', '9-10' yoki '11'. Berilmasa hamma guruhlar qaytadi.",
        },
      },
      required: [],
    },
  },
  {
    name: "create_lead",
    description:
      "Yangi mijozni (lead) bazaga yozadi. Ism, telefon, sinf va maqsad aniq bo'lgandagina chaqir. " +
      "Qaytgan lead_id keyingi vositalar uchun kerak. " +
      "Telefon raqamni o'zing tekshirma va rad etma: mijoz qanday yozgan bo'lsa, shunday ber. " +
      "Raqamni kod tekshiradi, noto'g'ri bo'lsa xato qaytaradi va nima qilishni aytadi.",
    input_schema: {
      type: "object",
      properties: {
        name: { type: "string", description: "O'quvchining ismi (familiyasi bo'lsa ham)" },
        phone: { type: "string", description: "Mijoz yozgan telefon raqam, o'zgartirmasdan" },
        grade: { type: "string", description: "Nechanchi sinf, masalan '7'" },
        goal: { type: "string", description: "Nima uchun kelyapti: maktab baholari, olimpiada, DTM va h.k." },
        level_summary: {
          type: "string",
          description:
            "Suhbatda aniqlangan daraja: qaysi misollarga to'g'ri yoki xato javob berdi, qayerda qiynaladi. Buni o'qituvchi o'qiydi.",
        },
      },
      required: ["name", "phone", "grade", "goal", "level_summary"],
    },
  },
  {
    name: "book_trial",
    description:
      "Leadni tanlangan guruhning bepul sinov darsiga yozadi. Faqat create_lead dan keyin va mijoz guruhga rozi bo'lgandan keyin chaqir.",
    input_schema: {
      type: "object",
      properties: {
        lead_id: { type: "string" },
        group_id: { type: "string", description: "list_groups natijasidagi id" },
      },
      required: ["lead_id", "group_id"],
    },
  },
  {
    name: "notify_teacher",
    description:
      "O'qituvchiga Telegram'da qisqa xabar yuboradi. Sinov darsiga yozilgandan keyin chaqir: o'quvchi kim, darajasi qanday, " +
      "darsda nimaga e'tibor berish kerak. Bu xabar faqat o'qituvchi uchun, mijoz uni ko'rmaydi. " +
      "Bu faqat ma'lumot uchun. Javob yoki qaror kerak bo'lsa, ask_teacher ishlat.",
    input_schema: {
      type: "object",
      properties: {
        lead_id: { type: "string" },
        message: { type: "string", description: "O'qituvchi uchun 3-5 qatorlik qisqa ma'lumot" },
      },
      required: ["lead_id", "message"],
    },
  },
  {
    name: "ask_teacher",
    description:
      "Mijozning sen javob bera olmaydigan yoki qaror qabul qila olmaydigan savolini Ustozga yuboradi: chegirma, " +
      "yangi guruh yoki boshqa vaqt ochish, to'lovni bo'lib to'lash va h.k. Mijozga \"Ustoz bilan aniqlashtiraman\" " +
      "demoqchi bo'lsang, AVVAL shu vositani chaqir. Ustozning javobi keyin shu chat orqali mijozga yetkaziladi.",
    input_schema: {
      type: "object",
      properties: {
        lead_id: { type: "string", description: "Lead yaratilgan bo'lsa, uning id'si" },
        customer_name: { type: "string", description: "Mijozning ismi, noma'lum bo'lsa \"noma'lum\"" },
        question: {
          type: "string",
          description: "Ustoz uchun savol va qisqa kontekst: kim, qaysi guruh, aynan nima so'rayapti",
        },
      },
      required: ["customer_name", "question"],
    },
  },
];

// ─────────────────────────────────────────────────────────────────────────────
// 3. VOSITALARNING HAQIQIY KODI (bizning serverimizda bajariladi)
//    Model faqat "shuni chaqir" deb so'raydi. Bajarish, tekshirish va rad etish
//    bizning qo'limizda. Xavfsizlik ham, ma'lumot to'g'riligi ham shu yerda.
// ─────────────────────────────────────────────────────────────────────────────

/** Model yuborgan parametrni tekshiradi: modelga ko'r-ko'rona ishonmaymiz. */
function str(input: Record<string, unknown>, key: string): string {
  const v = input[key];
  if (typeof v !== "string" || !v.trim()) throw new Error(`'${key}' parametri berilmagan yoki bo'sh.`);
  return v.trim();
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (/^998\d{9}$/.test(digits)) return `+${digits}`;
  if (/^\d{9}$/.test(digits)) return `+998${digits}`;
  // Xato matni modelga qaytadi, shuning uchun unga keyin nima qilishni ham aytamiz.
  throw new Error(`Telefon raqam noto'g'ri: "${raw}". Mijozdan raqamni +998 XX XXX XX XX ko'rinishida qayta so'ra.`);
}

const UZ_WEEKDAYS = ["yakshanba", "dushanba", "seshanba", "chorshanba", "payshanba", "juma", "shanba"];

/**
 * Guruhning eng yaqin darsi: aniq sana, hafta kuni va bugundan necha kun keyin.
 * Sana hisoblash modelga emas, kodga topshiriladi: model sanalarda tez-tez adashadi,
 * kod esa hech qachon adashmaydi.
 */
export function nextLesson(group: Group, now: Date = new Date()) {
  // O'zbekistonda yozgi vaqt yo'q: Toshkent vaqti doim UTC+5.
  const tashkent = new Date(now.getTime() + 5 * 3600_000);
  const [h, m] = group.time.split(":").map(Number);
  const nowMinutes = tashkent.getUTCHours() * 60 + tashkent.getUTCMinutes();
  for (let offset = 0; offset <= 7; offset++) {
    const day = new Date(tashkent.getTime() + offset * 86_400_000);
    if (!group.weekdays.includes(day.getUTCDay())) continue;
    if (offset === 0 && h * 60 + m <= nowMinutes) continue; // bugungi dars allaqachon boshlangan
    const dd = String(day.getUTCDate()).padStart(2, "0");
    const mm = String(day.getUTCMonth() + 1).padStart(2, "0");
    return {
      date: `${dd}.${mm}.${day.getUTCFullYear()}`,
      weekday: UZ_WEEKDAYS[day.getUTCDay()],
      time: group.time,
      days_from_today: offset, // 0 = bugun, 1 = ertaga
    };
  }
  throw new Error(`"${group.name}" guruhining dars kunlari belgilanmagan.`);
}

function runTool(name: string, input: Record<string, unknown>): unknown {
  switch (name) {
    case "list_groups": {
      const grade = typeof input.grade === "string" ? input.grade : undefined;
      return GROUPS.filter((g) => !grade || g.grade === grade);
    }

    case "create_lead": {
      const lead: Lead = {
        id: `L${LEADS.length + 1}`,
        name: str(input, "name"),
        phone: normalizePhone(str(input, "phone")),
        grade: str(input, "grade"),
        goal: str(input, "goal"),
        levelSummary: str(input, "level_summary"),
      };
      LEADS.push(lead);
      return { ok: true, lead_id: lead.id };
    }

    case "book_trial": {
      const lead = LEADS.find((l) => l.id === str(input, "lead_id"));
      if (!lead) throw new Error("Bunday lead yo'q. Avval create_lead chaqir.");
      const group = GROUPS.find((g) => g.id === str(input, "group_id"));
      if (!group) throw new Error("Bunday guruh yo'q. Id'ni list_groups natijasidan ol.");
      if (group.freeSeats <= 0) {
        throw new Error(`"${group.name}" guruhida bo'sh joy yo'q. Mijozga boshqa vaqtdagi mos guruhni taklif qil.`);
      }
      const lesson = nextLesson(group);
      group.freeSeats -= 1;
      lead.trialGroupId = group.id;
      return { ok: true, group: group.name, trial_lesson: lesson, price_first_lesson: 0 };
    }

    case "notify_teacher": {
      const lead = LEADS.find((l) => l.id === str(input, "lead_id"));
      if (!lead) throw new Error("Bunday lead yo'q.");
      out(box("📨 O'QITUVCHIGA (Telegram)", str(input, "message")));
      return { ok: true, delivered: true };
    }

    case "ask_teacher": {
      const leadId = typeof input.lead_id === "string" ? input.lead_id : undefined;
      if (leadId && !LEADS.some((l) => l.id === leadId)) throw new Error("Bunday lead yo'q. lead_id'ni bermasdan chaqir.");
      const q: Question = {
        id: `Q${QUESTIONS.length + 1}`,
        leadId,
        customerName: str(input, "customer_name"),
        question: str(input, "question"),
      };
      QUESTIONS.push(q);
      out(box("❓ USTOZGA SAVOL (javob kutilmoqda)", `${q.customerName}: ${q.question}`));
      // Laboratoriyada javob qaytmaydi. 1-bosqichda Ustoz Telegram'da javob yozadi
      // va bot uni shu mijozga yetkazadi: tavsifdagi va'da o'shanda haqiqatga aylanadi.
      return { ok: true, question_id: q.id };
    }

    default:
      throw new Error(`Noma'lum vosita: ${name}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. SYSTEM PROMPT: agentning "lavozim yo'riqnomasi"
// ─────────────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `Sen "Aniq Hisob" matematika o'quv markazining administratorisan. Telegram'da yangi mijozlar bilan gaplashasan.
Markazda bitta o'qituvchi dars beradi (Ustoz), sen uning yordamchisisan.

Vazifang: yangi mijozni sinov darsigacha olib borish. Quyidagi qadamlar so'roqnoma emas, tartib:
mijoz biror narsani allaqachon aytgan bo'lsa (yoki gapidan tushunarli bo'lsa), uni qayta so'rama va o'sha qadamni o'tkazib yubor.
1. Salomlash. Kim uchun (o'zi yoki farzandi) va nechanchi sinf ekanini bil.
2. Maqsadini bil: maktab baholari, olimpiada, DTM yoki milliy sertifikat va h.k.
3. Darajasini aniqla: sinfiga mos 2-3 ta qisqa misol ber, bittadan. Javobni izohlamasdan qabul qil va keyingisiga o't. Mijoz istamasa, majburlama.
4. list_groups bilan mos guruhni top va taklif qil.
5. Ism va telefon raqamni so'ra, keyin create_lead chaqir.
6. Mijoz rozi bo'lsa, book_trial chaqir.
7. notify_teacher bilan o'qituvchiga qisqa ma'lumot yubor.
8. Mijozga sinov darsining aniq sanasi, hafta kuni va vaqtini (book_trial natijasidan) aytib, xayrlash.

Qoidalar:
- Narx, jadval, bo'sh joy va sanalar faqat vositalar natijasidan olinadi. Hech qachon o'zingdan to'qima.
- Vosita bilan bajara olmaydigan ishni hech qachon va'da qilma.
- Chegirma, to'lovni qaytarish yoki yangi guruh ochish haqida qaror qabul qilmaysan. Bunday savolni ask_teacher bilan
  Ustozga yuborasan va mijozga savoli Ustozga yetkazilganini aytasan.
- Mijoz ma'lumotini (telefon, ism) o'zing tekshirma. Buni vositalar qiladi va xato bo'lsa aytadi.
- Telegram uslubi: qisqa xabarlar, bitta xabarda bitta savol.
- Mijoz qaysi tilda yozsa (o'zbek yoki rus), o'sha tilda javob ber.
- Vosita xato qaytarsa, sababini o'qi va shunga qarab harakat qil.`;

// ─────────────────────────────────────────────────────────────────────────────
// 5. AGENT SIKLI: butun "sehr" shu funksiyada
// ─────────────────────────────────────────────────────────────────────────────

// Standart: eng arzon model. Solishtirish uchun kuchliroq modelni yoqing:
//   MODEL=claude-sonnet-5-5 npm run 01      yoki      MODEL=claude-opus-5-5 npm run 01
const MODEL = process.env.MODEL ?? "claude-haiku-5-5";

// 1 million token narxi, dollar: [kirish, chiqish]
const PRICES: Record<string, [number, number]> = {
  "claude-haiku-5-5": [0.1, 0.5],
  "claude-sonnet-5-5": [2, 10],
  "claude-opus-5-5": [4, 20],
};

// Xavfsizlik filtri so'rovni rad etsa, server uni boshqa modelda qayta ishlaydi.
// Haiku 5.5 da bunday imkoniyat yo'q, shuning uchun faqat Sonnet va Opus uchun yoqamiz.
const FALLBACK =
  MODEL === "claude-haiku-5-5"
    ? {}
    : { betas: ["server-side-fallback-2026-07-01" as const], fallbacks: "default" as const };

const MAX_STEPS = 8; // bitta xabar uchun eng ko'p qadam: agent cheksiz aylanib qolmasin

// "Xotira" bu shunchaki massiv. Model hech narsani eslab qolmaydi:
// har bir so'rovda shu massivni boshidan oxirigacha qayta yuboramiz.
export const messages: Anthropic.Beta.BetaMessageParam[] = [];

export const usage = { input: 0, output: 0, calls: 0 };

/** quiet = true bo'lsa ekranga hech narsa chiqmaydi (evals uchun). */
export const settings = { quiet: false };
function out(s: string): void {
  if (!settings.quiet) console.log(s);
}
function box(title: string, text: string): string {
  return c.yellow(`\n  ┌─ ${title} ─────────────\n  │ ${text.split("\n").join("\n  │ ")}\n  └──────────────────────────────────────────`);
}

const client = new Anthropic();

/** Mijozning bitta xabarini qayta ishlaydi va agent shu navbatda yozgan matnni qaytaradi. */
export async function agentTurn(userText: string): Promise<string> {
  messages.push({ role: "user", content: userText });
  const replies: string[] = [];

  for (let step = 1; step <= MAX_STEPS; step++) {
    const res = await client.beta.messages.create({
      model: MODEL,
      max_tokens: 16000,
      system: SYSTEM_PROMPT,
      tools: TOOLS,
      messages,
      output_config: { effort: "medium" }, // fikrlash chuqurligi: low | medium | high | xhigh | max
      ...FALLBACK,
    });

    usage.calls += 1;
    usage.input += res.usage.input_tokens;
    usage.output += res.usage.output_tokens;
    out(
      c.dim(`  [qadam ${step}] stop_reason=${res.stop_reason} · kirish ${res.usage.input_tokens} token · chiqish ${res.usage.output_tokens} token`),
    );

    if (res.stop_reason === "refusal") {
      out(c.red("  ⛔ Model so'rovni rad etdi. Bu javob xotiraga qo'shilmadi."));
      return replies.join("\n");
    }

    // Model javobini TO'LIQ saqlaymiz (matn, vosita chaqiruvlari, fikrlash bloklari).
    // Faqat matnni saqlasak, keyingi so'rovda model nima qilganini "unutadi".
    messages.push({ role: "assistant", content: res.content });

    for (const block of res.content) {
      if (block.type === "text" && block.text.trim()) {
        replies.push(block.text);
        out(`\n${c.green("Agent:")} ${block.text}`);
      }
    }

    if (res.stop_reason !== "tool_use") {
      if (res.stop_reason === "max_tokens") out(c.red("  ⚠️  Javob max_tokens chegarasida kesildi."));
      return replies.join("\n"); // model javob berdi, navbat mijozda
    }

    // Model bir yoki bir nechta vosita chaqirishni so'radi. Hammasini bajaramiz
    // va natijalarni BITTA user xabarida qaytaramiz.
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const block of res.content) {
      if (block.type !== "tool_use") continue;
      TOOL_CALLS.push(block.name);
      out(c.cyan(`  🔧 ${block.name}(${JSON.stringify(block.input)})`));
      try {
        const output = runTool(block.name, (block.input ?? {}) as Record<string, unknown>);
        const json = JSON.stringify(output);
        out(c.dim(`     ↳ ${json.length > 300 ? json.slice(0, 300) + "…" : json}`));
        results.push({ type: "tool_result", tool_use_id: block.id, content: json });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        out(c.red(`     ↳ XATO: ${msg}`));
        // is_error: true modelga "bu ish bajarilmadi" deydi. Model xatoni o'qib, yo'lini o'zgartiradi.
        results.push({ type: "tool_result", tool_use_id: block.id, content: msg, is_error: true });
      }
    }
    messages.push({ role: "user", content: results });
    // ...va sikl boshiga qaytamiz: model natijalarni o'qib, keyingi qadamni hal qiladi.
  }

  out(c.red(`  ⚠️  ${MAX_STEPS} qadamdan oshdi, to'xtatildi.`));
  return replies.join("\n");
}

/** Soxta baza va suhbatni boshlang'ich holatga qaytaradi (evals har urinishni toza holatdan boshlaydi). */
export function resetState(): void {
  messages.length = 0;
  LEADS.length = 0;
  QUESTIONS.length = 0;
  TOOL_CALLS.length = 0;
  for (const g of GROUPS) g.freeSeats = INITIAL_SEATS.get(g.id) ?? g.freeSeats;
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. TERMINAL INTERFEYSI va o'rganish uchun buyruqlar
// ─────────────────────────────────────────────────────────────────────────────

const c = {
  dim: (s: string) => `\x1b[2m${s}\x1b[0m`,
  red: (s: string) => `\x1b[31m${s}\x1b[0m`,
  green: (s: string) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s: string) => `\x1b[33m${s}\x1b[0m`,
  cyan: (s: string) => `\x1b[36m${s}\x1b[0m`,
};

/** /xotira: model har safar aynan nimani "ko'rishini" ko'rsatadi. */
function showMemory(): void {
  console.log(c.yellow(`\nXotirada ${messages.length} ta xabar (har so'rovda hammasi qayta yuboriladi):`));
  messages.forEach((m, i) => {
    const content = m.content ?? [];
    const parts =
      typeof content === "string"
        ? [`text: "${content.slice(0, 60)}"`]
        : content.map((b) => {
            if (b.type === "text") return `text: "${b.text.slice(0, 60)}"`;
            if (b.type === "tool_use") return `tool_use: ${b.name}`;
            if (b.type === "tool_result") return `tool_result${b.is_error ? " (XATO)" : ""}`;
            return b.type; // masalan "thinking": modelning ichki fikrlash bloki
          });
    console.log(`  ${String(i + 1).padStart(2)}. ${m.role.padEnd(9)} ${parts.join(" | ")}`);
  });
}

/** /baza: vositalar haqiqatan nimani o'zgartirganini ko'rsatadi. */
function showDb(): void {
  console.log(c.yellow("\nLeadlar:"), LEADS.length ? "" : "(hali yo'q)");
  for (const l of LEADS) console.log("  ", l);
  console.log(c.yellow("Guruhlardagi bo'sh joylar:"));
  for (const g of GROUPS) console.log(`   ${g.id} ${g.name}: ${g.freeSeats}`);
  console.log(c.yellow("Ustozga savollar:"), QUESTIONS.length ? "" : "(yo'q)");
  for (const q of QUESTIONS) console.log(`   ${q.id} ${q.customerName}: ${q.question}`);
}

export function showUsage(): void {
  const price = PRICES[MODEL];
  const cost = price ? (usage.input / 1e6) * price[0] + (usage.output / 1e6) * price[1] : NaN;
  console.log(
    c.yellow(
      `\nJami (${MODEL}): ${usage.calls} ta API chaqiruv · kirish ${usage.input} · chiqish ${usage.output} token · ` +
        (price ? `taxminan $${cost.toFixed(4)}` : "narx jadvalda yo'q"),
    ),
  );
}

async function main(): Promise<void> {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.log(c.red("ANTHROPIC_API_KEY topilmadi."));
    console.log("1) console.anthropic.com → API Keys → Create Key");
    console.log("2) agent-lab/.env.example faylini agent-lab/.env deb nusxalang va kalitni qo'ying");
    console.log("3) Qayta ishga tushiring: npm run 01");
    process.exit(1);
  }

  console.log(c.yellow(`Matematika markazi · lead agenti (0-bosqich) · model: ${MODEL}`));
  console.log(c.dim("Siz mijozsiz: yangi o'quvchi yoki ota-ona sifatida yozing."));
  console.log(c.dim("Buyruqlar: /xotira · /baza · /narx · /yangi · /chiqish"));

  // Qatorlarni navbat bilan o'qiymiz: agent javob yozayotganda kelgan qatorlar ham yo'qolmaydi.
  const rl = readline.createInterface({ input: stdin, output: stdout, prompt: `\n${c.cyan("Siz:")} ` });
  rl.prompt();
  try {
    for await (const raw of rl) {
      const line = raw.trim();
      if (line === "/chiqish") break;
      if (line === "/xotira") showMemory();
      else if (line === "/baza") showDb();
      else if (line === "/narx") showUsage();
      else if (line === "/yangi") { messages.length = 0; console.log(c.dim("Suhbat tozalandi. Baza saqlanib qoldi.")); }
      else if (line) {
        try {
          await agentTurn(line);
        } catch (err) {
          if (err instanceof Anthropic.AuthenticationError) console.log(c.red("API kalit noto'g'ri yoki bekor qilingan."));
          else if (err instanceof Anthropic.RateLimitError) console.log(c.red("So'rovlar chegarasi: biroz kutib qayta urinib ko'ring."));
          else if (err instanceof Anthropic.APIError) console.log(c.red(`API xatosi ${err.status}: ${err.message}`));
          else throw err;
        }
      }
      rl.prompt();
    }
  } finally {
    rl.close();
    showUsage();
  }
}

// Fayl to'g'ridan-to'g'ri ishga tushirilgandagina terminal ochiladi.
// 02-evals.ts uni import qilganda faqat agent qismlari olinadi.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
