// Telegram texts (HTML, emoji) → plain SMS text. Emoji and other non-GSM symbols would switch the
// SMS to UCS-2 (70 characters per part instead of 160) and make every message cost more.

const ENTITIES: Record<string, string> = { "&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": '"', "&#39;": "'" };

/** Strip tags, decode the entities esc() produces, drop emoji / pictographs, tidy whitespace. */
export function htmlToSms(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&(amp|lt|gt|quot|#39);/g, (m) => ENTITIES[m])
    .replace(/[\p{Extended_Pictographic}\u{FE0F}\u{200D}\u{20E3}]/gu, "")
    .replace(/[ \t]+/g, " ")
    .split("\n")
    .map((l) => l.trim())
    .filter((l, i, a) => l !== "" || (i > 0 && a[i - 1] !== ""))
    .join("\n")
    .trim();
}

/** Parts the SMS will be billed as: GSM-7 160/153 per part, UCS-2 (any non-Latin letter, e.g. Cyrillic) 70/67. */
export function smsParts(text: string): number {
  const gsm = /^[\x0A\x0D\x20-\x7E£¥èéùìòÇØøÅåÆæßÉ¡ÄÖÑÜ§¿äöñüà]*$/.test(text);
  const [one, many] = gsm ? [160, 153] : [70, 67];
  return text.length <= one ? 1 : Math.ceil(text.length / many);
}
