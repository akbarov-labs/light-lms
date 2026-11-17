/**
 * EVALS: agentni avtomatik tekshirish.
 *
 * Har bir holat birinchi jonli suhbatda topilgan haqiqiy xato. Promptni har safar
 * o'zgartirganda shu faylni ishga tushiramiz: bitta xatoni tuzatib, boshqasini
 * buzib qo'ymaganimizni darhol ko'ramiz.
 *
 * Ikki xil test bor:
 *  - KOD testlari (nextLesson): natija har doim bir xil, bir marta tekshirish yetadi, API kerak emas.
 *  - MODEL testlari: model har safar biroz boshqacha javob beradi. Shuning uchun har holat
 *    bir necha marta ishlatiladi va natija "3/3" ko'rinishida chiqadi.
 *
 * Model testlari suhbatni boshidan o'ynamaydi. Ular tayyor tarixdan (suhbat o'rtasidan)
 * boshlanadi va faqat tekshirilayotgan bitta qadamni sinaydi: arzonroq va barqarorroq.
 *
 * Ishga tushirish:  npm run evals          (Haiku'da taxminan bir sent)
 *                   RUNS=10 npm run evals  (aniqroq natija uchun)
 */

import type Anthropic from "@anthropic-ai/sdk";
import {
  GROUPS,
  LEADS,
  TOOL_CALLS,
  agentTurn,
  messages,
  nextLesson,
  resetState,
  settings,
  showUsage,
} from "./01-raw-loop.ts";

settings.quiet = true;
const RUNS = Number(process.env.RUNS ?? 3);

const u = (text: string): Anthropic.Beta.BetaMessageParam => ({ role: "user", content: text });
const a = (text: string): Anthropic.Beta.BetaMessageParam => ({ role: "assistant", content: text });

// ─────────────────────────────────────────────────────────────────────────────
// KOD TESTLARI: sana hisoblash (4-xato)
// ─────────────────────────────────────────────────────────────────────────────

function codeTests(): boolean {
  const g1 = GROUPS.find((g) => g.id === "g1")!; // Du, Chor, Ju 15:00
  const g5 = GROUPS.find((g) => g.id === "g5")!; // Du-Sha 18:30
  const cases = [
    // [nima tekshirilyapti, guruh, hozirgi vaqt (UTC), kutilgan sana, kutilgan kun]
    ["Dushanba ertalab → o'sha kuni kechqurun", g5, "2026-11-16T05:00:00Z", "16.11.2026", "dushanba"],
    ["Dushanba dars boshlangandan keyin → seshanba", g5, "2026-11-16T14:00:00Z", "17.11.2026", "seshanba"],
    ["Shanba → keyingi dushanba", g1, "2026-11-21T07:00:00Z", "23.11.2026", "dushanba"],
  ] as const;

  let ok = true;
  console.log("\nKOD testlari (nextLesson):");
  for (const [name, group, now, date, weekday] of cases) {
    const got = nextLesson(group, new Date(now));
    const pass = got.date === date && got.weekday === weekday;
    ok &&= pass;
    console.log(`  ${pass ? "✅" : "❌"} ${name}${pass ? "" : `: kutilgan ${date} ${weekday}, chiqdi ${got.date} ${got.weekday}`}`);
  }
  return ok;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODEL TESTLARI (1-3-xatolar)
// check() muvaffaqiyatda null, xatoda sababini qaytaradi.
// ─────────────────────────────────────────────────────────────────────────────

type ModelCase = {
  name: string;
  history: Anthropic.Beta.BetaMessageParam[];
  input: string;
  check: (reply: string) => string | null;
};

const LEVEL_DONE: Anthropic.Beta.BetaMessageParam[] = [
  u("Assalomu alaykum, 11-sinfda o'qiyman, bu yil oliy ta'limga topshirmoqchiman"),
  a("Va alaykum assalom! Darajangizni bilish uchun misol: x² − 5x + 6 = 0 tenglamaning ildizlarini toping."),
  u("2 va 3"),
  a("Yana bittasi: f(x) = x³ − 3x funksiyaning x = 2 nuqtadagi hosilasi nechaga teng?"),
  u("9"),
  a(
    "Rahmat! Sizga \"Abituriyentlar (DTM, milliy sertifikat)\" guruhi mos keladi: Du–Sha, soat 18:30, oyiga 650 000 so'm. " +
      "Bepul sinov darsiga yozilish uchun ismingiz va telefon raqamingizni yuboring.",
  ),
];

const MODEL_CASES: ModelCase[] = [
  {
    name: "1. Telefonni model o'zi rad etmaydi",
    history: LEVEL_DONE,
    input: "Sarvar 901234599",
    check: (reply) =>
      LEADS.some((l) => l.phone === "+998901234599")
        ? null
        : `create_lead chaqirilmadi yoki raqam boshqacha saqlandi. Vositalar: [${TOOL_CALLS.join(", ")}]. Javob: ${reply}`,
  },
  {
    name: "2. Va'da berishdan oldin Ustozga savol yuboradi",
    history: [
      ...LEVEL_DONE,
      u("Sarvar +998901234599"),
      a("Sarvar, sinov darsingiz yozildi: Abituriyentlar guruhi, 17.11.2026, seshanba, soat 18:30. Birinchi dars bepul."),
    ],
    input: "Kurs narxini arzonroq qilish mumkinmi? 650 ming ozroq qimmatlik qilyapti",
    check: (reply) =>
      TOOL_CALLS.includes("ask_teacher") ? null : `ask_teacher chaqirilmadi. Vositalar: [${TOOL_CALLS.join(", ")}]. Javob: ${reply}`,
  },
  {
    name: "3. Aytilgan narsani qayta so'ramaydi",
    history: [],
    input: "Assalomu alaykum, 11-sinfda o'qiyman, bu yil oliy ta'limga topshirmoqchiman, o'zim uchun kurs qidiryapman",
    // Oddiy kalit so'z tekshiruvi. Bu qo'pol usul: keyinroq javobni boshqa model baholaydigan
    // "LLM-judge" usulini o'rganamiz.
    check: (reply) => (/kim uchun|nechanchi sinf|farzand/i.test(reply) ? `Qayta so'radi: ${reply}` : null),
  },
];

async function modelTests(): Promise<boolean> {
  let allPassed = true;
  console.log(`\nMODEL testlari (har biri ${RUNS} marta):`);
  for (const tc of MODEL_CASES) {
    let passed = 0;
    const failures: string[] = [];
    for (let i = 0; i < RUNS; i++) {
      resetState();
      messages.push(...tc.history);
      const reply = await agentTurn(tc.input);
      const problem = tc.check(reply);
      if (problem) failures.push(problem);
      else passed++;
    }
    allPassed &&= passed === RUNS;
    console.log(`  ${passed === RUNS ? "✅" : "❌"} ${tc.name}: ${passed}/${RUNS}`);
    for (const f of failures) console.log(`       ↳ ${f.replace(/\s+/g, " ").slice(0, 220)}`);
  }
  return allPassed;
}

const codeOk = codeTests();
const modelOk = await modelTests();
showUsage();
process.exit(codeOk && modelOk ? 0 : 1);
