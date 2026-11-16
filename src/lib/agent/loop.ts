// The agent loop (the same shape as agent-lab/01-raw-loop.ts): send the history, run the tools the model
// asks for, send their results back, repeat until the model answers. No database and no Telegram here;
// the model call is injected, so tests drive the loop with scripted responses and no API cost.
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
  execute: (name: string, input: Record<string, unknown>) => Promise<unknown>;
  /** called after every model call, before tools run (metering) */
  onUsage?: (u: { input: number; output: number }) => Promise<void>;
  /** called with each text the agent writes, in order, before that step's tools run (so tool output such as group cards lands after it) */
  onReply?: (text: string) => void;
  maxSteps?: number;
}

export interface TurnResult {
  /** full history after this turn, thinking blocks still in place */
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
  const replies: string[] = [];
  const toolCalls: string[] = [];
  const maxSteps = t.maxSteps ?? MAX_STEPS;

  for (let step = 1; step <= maxSteps; step++) {
    const res = await t.create({
      model: t.model,
      max_tokens: 16_000,
      system: t.system,
      tools: t.tools,
      messages: history,
      output_config: { effort: "medium" },
      ...fallbackParams(t.model),
    });
    await t.onUsage?.({ input: res.usage.input_tokens, output: res.usage.output_tokens });

    // a refused answer is not kept: the next turn starts from the person's message again
    if (res.stop_reason === "refusal") return { history, replies, toolCalls, steps: step, stopped: "refusal" };

    // keep the whole answer (text, tool calls, thinking): tool results must point at these tool_use ids
    history.push({ role: "assistant", content: res.content });
    for (const b of res.content) {
      if (b.type !== "text" || !b.text.trim()) continue;
      replies.push(b.text.trim());
      t.onReply?.(b.text.trim());
    }

    if (res.stop_reason !== "tool_use") {
      return { history, replies, toolCalls, steps: step, stopped: res.stop_reason === "max_tokens" ? "max_tokens" : undefined };
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
  }
  return { history, replies, toolCalls, steps: maxSteps, stopped: "max_steps" };
}
