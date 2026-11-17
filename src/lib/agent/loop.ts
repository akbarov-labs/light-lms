// The agent loop (the same shape as agent-lab/01-raw-loop.ts): send the history, run the tools the model
// asks for, send their results back, repeat until the model answers. No database and no Telegram here;
// the model call is injected, so tests drive the loop with scripted responses and no API cost.
//
// Prompt caching (a prefix match: tools -> system -> messages): one explicit breakpoint on the system prompt,
// which is the same for every chat of a center, plus top-level automatic caching for the growing history.
// What changes every turn (the chat's state block) goes AFTER the cached prefix as a mid-conversation
// role:"system" message — inside the top-level system prompt it would invalidate the whole history cache.
import Anthropic from "@anthropic-ai/sdk";
import { mergeUserTurns, type AgentMessage } from "./history";

export type AgentTool = Anthropic.Beta.BetaTool;
export type CreateMessage = (params: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming) => Promise<Anthropic.Beta.BetaMessage>;

/** A tool refusing a call. The message goes back to the model as an error result, so write it for the model. */
export class AgentToolError extends Error {}

export interface TurnInput {
  create: CreateMessage;
  model: string;
  system: string;
  tools: AgentTool[];
  history: AgentMessage[];
  userText: string;
  /**
   * The chat's facts (the state block), sent as a role:"system" message after the person's message and a
   * fresh copy after every tool step (an instruction left behind the tool results fades: the script rule
   * held 1/3 with one copy). Read again each time, so a booking made mid-turn shows. Not kept in history.
   */
  turnSystem?: () => Promise<string>;
  execute: (name: string, input: Record<string, unknown>) => Promise<unknown>;
  /** called after every model call, before tools run (metering); input = uncached input only */
  onUsage?: (u: TurnUsage) => Promise<void>;
  /** called with each text the agent writes, in order, before that step's tools run (so tool output such as group cards lands after it) */
  onReply?: (text: string) => void;
  maxSteps?: number;
}

/** One model call's tokens. Total prompt = input + cacheRead + cacheWrite. */
export interface TurnUsage {
  input: number;
  output: number;
  /** served from cache (~0.1× input price) */
  cacheRead: number;
  /** written to cache (~1.25× input price, 5-minute TTL) */
  cacheWrite: number;
}

export interface TurnResult {
  /** full history after this turn, thinking blocks still in place, the turn's system message left out */
  history: AgentMessage[];
  /** text the agent wrote this turn, in order */
  replies: string[];
  /** tools the model called this turn, in order */
  toolCalls: string[];
  steps: number;
  stopped?: "max_steps" | "refusal" | "max_tokens";
}

export const MAX_STEPS = 8;

/** Server-side fallback on a refusal exists for Sonnet / Opus 5.5, not for Haiku 5.5. */
function fallbackParams(model: string): Pick<Anthropic.Beta.Messages.MessageCreateParamsNonStreaming, "betas" | "fallbacks"> {
  if (model === "claude-opus-5-5" || model === "claude-sonnet-5-5") return { betas: ["server-side-fallback-2026-07-01"], fallbacks: "default" };
  return {};
}

export async function runTurn(t: TurnInput): Promise<TurnResult> {
  // a staff message (or a failed turn) may have left a person turn unanswered: this message joins it
  const history: AgentMessage[] = mergeUserTurns([...t.history, { role: "user", content: t.userText }]);
  // the state block follows the person's message and stays there for the whole tool loop of this turn
  if (t.turnSystem) history.push({ role: "system", content: await t.turnSystem() });
  const kept = () => history.filter((m) => m.role !== "system");
  const replies: string[] = [];
  const toolCalls: string[] = [];
  const maxSteps = t.maxSteps ?? MAX_STEPS;

  for (let step = 1; step <= maxSteps; step++) {
    const res = await t.create({
      model: t.model,
      max_tokens: 16_000,
      system: [{ type: "text", text: t.system, cache_control: { type: "ephemeral" } }],
      tools: t.tools,
      messages: history,
      cache_control: { type: "ephemeral" },
      output_config: { effort: "medium" },
      ...fallbackParams(t.model),
    });
    await t.onUsage?.({
      input: res.usage.input_tokens,
      output: res.usage.output_tokens,
      cacheRead: res.usage.cache_read_input_tokens ?? 0,
      cacheWrite: res.usage.cache_creation_input_tokens ?? 0,
    });

    // a refused answer is not kept: the next turn starts from the person's message again
    if (res.stop_reason === "refusal") return { history: kept(), replies, toolCalls, steps: step, stopped: "refusal" };

    // keep the whole answer (text, tool calls, thinking): tool results must point at these tool_use ids
    history.push({ role: "assistant", content: res.content });
    for (const b of res.content) {
      if (b.type !== "text" || !b.text.trim()) continue;
      replies.push(b.text.trim());
      t.onReply?.(b.text.trim());
    }

    if (res.stop_reason !== "tool_use") {
      return { history: kept(), replies, toolCalls, steps: step, stopped: res.stop_reason === "max_tokens" ? "max_tokens" : undefined };
    }

    // every tool_use gets a result, all of them in ONE user message
    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const b of res.content) {
      if (b.type !== "tool_use") continue;
      toolCalls.push(b.name);
      try {
        const out = await t.execute(b.name, (b.input ?? {}) as Record<string, unknown>);
        results.push({ type: "tool_result", tool_use_id: b.id, content: JSON.stringify(out) });
      } catch (e) {
        // our own refusals are written for the model; anything else is a bug and stays in our logs
        const text = e instanceof AgentToolError ? e.message : "Ichki xato: bu amal bajarilmadi. Mijozga keyinroq urinib ko'rishni ayt yoki ask_teacher ishlat.";
        if (!(e instanceof AgentToolError)) console.error(`[agent] tool ${b.name} failed`, e);
        results.push({ type: "tool_result", tool_use_id: b.id, content: text, is_error: true });
      }
    }
    history.push({ role: "user", content: results });
    // earlier copies stay where they are: removing one would be a history edit (cache miss)
    if (t.turnSystem) history.push({ role: "system", content: await t.turnSystem() });
  }
  return { history: kept(), replies, toolCalls, steps: maxSteps, stopped: "max_steps" };
}
