import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { AgentToolError, runTurn, type CreateMessage } from "./loop";

type Block = Anthropic.Beta.BetaContentBlock;
const msg = (content: Block[], stop: Anthropic.Beta.BetaMessage["stop_reason"]): Anthropic.Beta.BetaMessage =>
  ({ id: "m", type: "message", role: "assistant", model: "test", content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 100, output_tokens: 10 } }) as unknown as Anthropic.Beta.BetaMessage;
const text = (t: string) => ({ type: "text", text: t, citations: null }) as unknown as Block;
const call = (id: string, name: string, input: object = {}) => ({ type: "tool_use", id, name, input }) as unknown as Block;

/** A scripted model: returns the given answers in order and records every request. */
function script(...answers: Anthropic.Beta.BetaMessage[]) {
  const seen: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming[] = [];
  const create: CreateMessage = async (p) => {
    seen.push(structuredClone(p));
    const a = answers.shift();
    if (!a) throw new Error("no more scripted answers");
    return a;
  };
  return { create, seen };
}

const base = { model: "claude-haiku-5-5", system: "sys", tools: [], history: [] };

describe("runTurn", () => {
  it("runs the tool the model asks for, sends the result back, and returns the final text", async () => {
    const m = script(msg([call("t1", "list_groups", { course: "mat" })], "tool_use"), msg([text("Bitta guruh bor")], "end_turn"));
    const calls: unknown[] = [];
    const r = await runTurn({ ...base, create: m.create, userText: "salom", execute: async (name, input) => (calls.push([name, input]), [{ id: "g1" }]) });
    expect(calls).toEqual([["list_groups", { course: "mat" }]]);
    expect(r.replies).toEqual(["Bitta guruh bor"]);
    expect(r.toolCalls).toEqual(["list_groups"]);
    expect(m.seen[1].messages.at(-1)).toEqual({ role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: '[{"id":"g1"}]' }] });
    expect(r.history.map((x) => x.role)).toEqual(["user", "assistant", "user", "assistant"]);
  });

  it("answers every tool call of one step in a single message, errors included", async () => {
    const m = script(msg([call("a", "ok"), call("b", "refuse"), call("c", "crash")], "tool_use"), msg([text("tayyor")], "end_turn"));
    await runTurn({
      ...base,
      create: m.create,
      userText: "x",
      execute: async (name) => {
        if (name === "refuse") throw new AgentToolError("Avval telefon kerak.");
        if (name === "crash") throw new Error("db password in here");
        return { ok: true };
      },
    });
    const results = m.seen[1].messages.at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[];
    expect(results.map((r) => [r.tool_use_id, r.is_error ?? false])).toEqual([["a", false], ["b", true], ["c", true]]);
    expect(results[1].content).toBe("Avval telefon kerak.");
    expect(JSON.stringify(results[2])).not.toContain("password"); // internal errors never reach the model
  });

  it("stops after maxSteps so a looping model cannot burn money", async () => {
    const loop = () => msg([call("t", "list_groups")], "tool_use");
    const m = script(loop(), loop(), loop());
    const r = await runTurn({ ...base, create: m.create, userText: "x", execute: async () => ({}), maxSteps: 3 });
    expect(r.stopped).toBe("max_steps");
    expect(m.seen).toHaveLength(3);
  });

  it("does not keep a refused answer", async () => {
    const m = script(msg([], "refusal"));
    const r = await runTurn({ ...base, create: m.create, userText: "x", execute: async () => ({}) });
    expect(r.stopped).toBe("refusal");
    expect(r.history).toEqual([{ role: "user", content: "x" }]);
  });

  it("meters every call and asks for a server-side fallback only on models that have one", async () => {
    const usage: number[] = [];
    const haiku = script(msg([text("a")], "end_turn"));
    await runTurn({ ...base, create: haiku.create, userText: "x", execute: async () => ({}), onUsage: async (u) => void usage.push(u.input) });
    expect(usage).toEqual([100]);
    expect(haiku.seen[0]).not.toHaveProperty("fallbacks");
    const sonnet = script(msg([text("a")], "end_turn"));
    await runTurn({ ...base, model: "claude-sonnet-5-5", create: sonnet.create, userText: "x", execute: async () => ({}) });
    expect(sonnet.seen[0]).toMatchObject({ fallbacks: "default", betas: ["server-side-fallback-2026-07-01"] });
  });
});
