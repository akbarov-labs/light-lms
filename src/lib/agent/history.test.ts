import { describe, expect, it } from "vitest";
import { isPersonTurn, stripThinking, trimHistory, type AgentMessage } from "./history";

const user = (text: string): AgentMessage => ({ role: "user", content: text });
const toolCall = (id: string): AgentMessage => ({
  role: "assistant",
  content: [
    { type: "thinking", thinking: "", signature: "sig" },
    { type: "tool_use", id, name: "list_groups", input: {} },
  ],
});
const toolResult = (id: string): AgentMessage => ({ role: "user", content: [{ type: "tool_result", tool_use_id: id, content: "[]" }] });
const answer = (text: string): AgentMessage => ({ role: "assistant", content: [{ type: "thinking", thinking: "", signature: "s" }, { type: "text", text }] });

describe("stripThinking", () => {
  it("removes thinking blocks and keeps text and tool calls", () => {
    const out = stripThinking([user("salom"), toolCall("t1"), toolResult("t1"), answer("Va alaykum")]);
    expect(out).toHaveLength(4);
    expect(JSON.stringify(out)).not.toContain("thinking");
    expect(out[1]).toEqual({ role: "assistant", content: [{ type: "tool_use", id: "t1", name: "list_groups", input: {} }] });
  });

  it("drops an assistant message that held only thinking", () => {
    const out = stripThinking([user("a"), { role: "assistant", content: [{ type: "thinking", thinking: "", signature: "s" }] }, user("b")]);
    expect(out).toEqual([user("a"), user("b")]);
  });
});

describe("trimHistory", () => {
  it("keeps a short history as it is", () => {
    const h = [user("a"), answer("b")];
    expect(trimHistory(h)).toEqual(h);
  });

  it("drops whole turns from the front and never starts at a tool result", () => {
    const h: AgentMessage[] = [];
    for (let i = 0; i < 10; i++) h.push(user(`savol ${i}`), toolCall(`t${i}`), toolResult(`t${i}`), answer(`javob ${i}`));
    const out = trimHistory(h, { maxMessages: 10, maxChars: 1_000_000 });
    expect(out.length).toBeLessThanOrEqual(10);
    expect(isPersonTurn(out[0])).toBe(true);
    // every tool_use still has its tool_result right after it
    out.forEach((m, i) => {
      if (m.role !== "assistant" || !Array.isArray(m.content)) return;
      for (const b of m.content) if (b.type === "tool_use") expect(out[i + 1]).toEqual(toolResult(b.id));
    });
    expect(out.at(-1)).toEqual(answer("javob 9"));
  });

  it("trims by size too, but always keeps the newest turn even when it alone is too big", () => {
    const big = "x".repeat(5_000);
    const out = trimHistory([user("eski"), answer("ok"), user(big), answer("ok")], { maxMessages: 60, maxChars: 1_000 });
    expect(out).toEqual([user(big), answer("ok")]);
  });

  it("repairs a history that starts mid-turn", () => {
    expect(trimHistory([toolResult("t0"), answer("a"), user("b"), answer("c")])).toEqual([user("b"), answer("c")]);
  });
});
