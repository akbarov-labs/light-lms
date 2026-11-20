// The tutor's per-chat memory and daily limit, as pure functions (unit-tested; the service applies them).
import { esc } from "@/lib/messages";

export interface TutorMessage {
  role: "user" | "assistant";
  content: string;
}

/** Messages kept per chat and sent to the model: the last ~10 turns. */
export const TUTOR_HISTORY = 20;
/** A Telegram message holds 4096 characters; the prompt asks for ~900. */
const MAX_REPLY_CHARS = 3500;

/** The last `max` messages, starting at a student's message (the API wants the user first). */
export function trimTurns(messages: TutorMessage[], max = TUTOR_HISTORY): TutorMessage[] {
  const valid = (Array.isArray(messages) ? messages : []).filter(
    (m) => (m?.role === "user" || m?.role === "assistant") && typeof m.content === "string" && m.content.trim() !== "",
  );
  let out = valid.slice(-max);
  while (out.length && out[0].role !== "user") out = out.slice(1);
  return out;
}

/**
 * The day's count after one more message, or null when the limit is reached; a new Tashkent date starts at 1.
 * The service applies it with a conditional update, so two messages at once cannot both take the last slot.
 */
export function nextDayCount(row: { day: string; dayMessages: number }, today: string, limit: number): number | null {
  if (row.day !== today) return 1;
  return row.dayMessages < limit ? row.dayMessages + 1 : null;
}

/** The model's plain text for Telegram's HTML parse mode: escaped, **bold** kept, cut to fit. */
export function toTelegramHtml(text: string): string {
  const cut = text.length > MAX_REPLY_CHARS ? `${text.slice(0, MAX_REPLY_CHARS).trimEnd()}…` : text;
  return esc(cut).replace(/\*\*([^*\n]{1,80})\*\*/g, "<b>$1</b>");
}
