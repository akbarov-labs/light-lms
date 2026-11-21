// Does a free-text message from a chat go to the math tutor? Pure, so the decision is unit-tested; the bot
// (src/worker/bot/tutor.ts) gathers the facts. Menu buttons and the lead agent's chats never reach here: the
// bot handles them first.

export type TutorRoute =
  /** the tutor answers */
  | "tutor"
  /** the chat is in the middle of another flow (a homework sheet, a test): told so, no tutor */
  | "busy"
  /** not the tutor's: today's behavior goes on */
  | "skip";

export interface RouteFacts {
  text: string;
  /** a linked student or parent of a center with the tutor on (tutorFor found one) */
  eligible: boolean;
  /** a homework sheet is open in this chat (answering, or its summary shown) */
  sheetOpen: boolean;
  /** a test is in progress in this chat (none in the bot yet; a quiz flow plugs in here) */
  testOpen?: boolean;
}

export function tutorRoute(f: RouteFacts): TutorRoute {
  const text = f.text.trim();
  if (!f.eligible || !text || text.startsWith("/")) return "skip";
  if (f.sheetOpen || f.testOpen) return "busy";
  return "tutor";
}
