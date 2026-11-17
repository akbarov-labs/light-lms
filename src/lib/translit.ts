// Uzbek Latin -> Cyrillic, by rule. The AI agent is told to answer Cyrillic to people who write Cyrillic,
// but after tool results (Latin data) Haiku drifted back to Latin in about 1 reply of 9: what is exact is
// code's job, so replies, cards and buttons in a Cyrillic conversation pass through this.
//
// Kept as written: links, e-mails, @usernames, bot commands (/start), HTML tags and entities, all-caps
// abbreviations (DTM, IELTS), tokens with digits (A1, B2) and a few brand names. Known limits, rare in Uzbek: "ts" stays "тс" (цирк
// becomes тсирк), the soft sign of Russian loans is not restored (компютер), "s'h" is read as "сҳ".

const APOS = /['ʻʼ‘’`]/;
const VOWELS = "aeiouаеиоуўэюяё";
const SINGLE: Record<string, string> = {
  a: "а", b: "б", c: "с", d: "д", e: "е", f: "ф", g: "г", h: "ҳ", i: "и", j: "ж", k: "к", l: "л", m: "м",
  n: "н", o: "о", p: "п", q: "қ", r: "р", s: "с", t: "т", u: "у", v: "в", w: "в", x: "х", y: "й", z: "з",
};
const Y_PAIRS: Record<string, string> = { o: "ё", a: "я", u: "ю", e: "е" };
const BRANDS = new Set(["payme", "click", "uzum", "telegram", "instagram", "google", "yandex", "whatsapp", "zoom", "youtube"]);

function word(w: string): string {
  if (BRANDS.has(w.toLowerCase())) return w;
  const lower = w.toLowerCase();
  let out = "";
  let i = 0;
  while (i < w.length) {
    const c = lower[i];
    const next = lower[i + 1] ?? "";
    const upper = w[i] !== lower[i];
    const put = (s: string) => (out += upper ? s.toUpperCase() : s);
    if ((c === "o" || c === "g") && APOS.test(next)) {
      put(c === "o" ? "ў" : "ғ");
      i += 2;
    } else if ((c === "s" || c === "c") && next === "h") {
      put(c === "s" ? "ш" : "ч");
      i += 2;
    } else if (c === "y" && next in Y_PAIRS && !(next === "o" && APOS.test(lower[i + 2] ?? ""))) {
      // "yo'l" is й + ў, not ё
      put(Y_PAIRS[next]);
      i += 2;
    } else if (c === "e") {
      // э at the start of a word and after a vowel (ertaga, poezd), е elsewhere
      put(i === 0 || VOWELS.includes(lower[i - 1] ?? "") ? "э" : "е");
      i += 1;
    } else if (APOS.test(w[i])) {
      // the glottal stop inside a word (ma'lumot) is ъ; a quote mark at either end stays
      out += i > 0 && i < w.length - 1 ? "ъ" : w[i];
      i += 1;
    } else {
      out += SINGLE[c] ? (upper ? SINGLE[c].toUpperCase() : SINGLE[c]) : w[i];
      i += 1;
    }
  }
  return out;
}

// protected spans first, then Latin words (apostrophes inside them belong to the word)
const TOKENS =
  /(https?:\/\/\S+|www\.\S+|t\.me\/\S+|\S+@\S+\.\w+|@\w+|(?<!\S)\/\w+|<[^>]*>|&#?\w+;|\b[A-Za-z]*\d[A-Za-z\d]*\b|\b[A-Z]{2,}\b)|([A-Za-z]+(?:['ʻʼ‘’`][A-Za-z]+)*['ʻʼ‘’`]?)/g;

/** Uzbek Latin text to Cyrillic; text already in Cyrillic (Uzbek or Russian) passes unchanged. */
export function latinToCyrillic(text: string): string {
  return text.replace(TOKENS, (m, kept: string | undefined, w: string | undefined) => (kept ? m : word(w ?? m)));
}
