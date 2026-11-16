// Conversation memory for the AI agent: what is kept between turns (AgentChat.messages).
//
// Three rules, all pure functions so they are unit-tested without a model:
// 1. Thinking blocks are dropped when a turn ends. On current models a thinking block is bound to the
//    exact conversation that produced it: trimming old turns or changing the system prompt (the center
//    renamed itself, new center rules) would make every saved block invalid and the API would answer
//    400. Removing all of them is always allowed. Inside one turn (the tool loop) they are kept.
// 2. The history is trimmed from the front, whole turns at a time: it only ever starts at a message the
//    person wrote, so a tool_use is never separated from its tool_result.
// 3. Consecutive person turns (a staff message, then the person's reply) are merged into one before sending.
import type Anthropic from "@anthropic-ai/sdk";

export type AgentMessage = Anthropic.Beta.BetaMessageParam;

const THINKING = new Set(["thinking", "redacted_thinking"]);

/** Remove thinking blocks; an assistant message left empty is removed too. */
export function stripThinking(messages: AgentMessage[]): AgentMessage[] {
  const out: AgentMessage[] = [];
  for (const m of messages) {
    if (m.role !== "assistant" || typeof m.content === "string" || !m.content) {
      out.push(m);
      continue;
    }
    const content = m.content.filter((b) => !THINKING.has(b.type));
    if (content.length > 0) out.push({ ...m, content });
  }
  return out;
}

/** A turn the person wrote (text), not tool results: the only place a history may start. */
export function isPersonTurn(m: AgentMessage): boolean {
  if (m.role !== "user") return false;
  if (typeof m.content === "string") return true;
  return (m.content ?? []).length > 0 && (m.content ?? []).every((b) => b.type !== "tool_result");
}

/**
 * Join consecutive person turns into one user message (each keeps its own text block). They appear when a
 * staff message or a failed turn left a user message with no answer yet; the API wants one turn per side.
 */
export function mergeUserTurns(messages: AgentMessage[]): AgentMessage[] {
  const out: AgentMessage[] = [];
  const blocks = (m: AgentMessage): Anthropic.Beta.BetaContentBlockParam[] => (typeof m.content === "string" ? [{ type: "text", text: m.content }] : [...(m.content ?? [])]);
  for (const m of messages) {
    const prev = out[out.length - 1];
    if (prev && isPersonTurn(prev) && isPersonTurn(m)) out[out.length - 1] = { role: "user", content: [...blocks(prev), ...blocks(m)] };
    else out.push(m);
  }
  return out;
}

export const HISTORY_LIMITS = { maxMessages: 60, maxChars: 40_000 };

/** Drop the oldest whole turns until the history fits; the newest turn is always kept. */
export function trimHistory(messages: AgentMessage[], limits = HISTORY_LIMITS): AgentMessage[] {
  let start = 0;
  while (start < messages.length && !isPersonTurn(messages[start])) start++; // never start mid-turn
  const fits = (from: number) => messages.length - from <= limits.maxMessages && JSON.stringify(messages.slice(from)).length <= limits.maxChars;
  while (!fits(start)) {
    let next = start + 1;
    while (next < messages.length && !isPersonTurn(messages[next])) next++;
    if (next >= messages.length) break;
    start = next;
  }
  return messages.slice(start);
}
