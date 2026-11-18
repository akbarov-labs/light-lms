// Sabaq's own sales agent (src/lib/sales-agent) on the real database with a scripted model: no API key, no cost.
// Run: npm run test:integration
import { describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/lib/db";
import { monthKey, todayISO } from "@/lib/dates";
import type { CreateMessage } from "@/lib/agent/loop";
import { SALES_MARK, activeSalesChat, handleSalesMessage, openSalesChat, recordSalesPhone, salesChatOfTeamMessage, salesText } from "@/lib/sales-agent/service";

type Block = Anthropic.Beta.BetaContentBlock;
const msg = (content: Block[], stop: Anthropic.Beta.BetaMessage["stop_reason"]) =>
  ({ id: "m", type: "message", role: "assistant", model: "test", content, stop_reason: stop, stop_sequence: null, usage: { input_tokens: 1000, output_tokens: 50 } }) as unknown as Anthropic.Beta.BetaMessage;
const text = (t: string) => ({ type: "text", text: t, citations: null }) as unknown as Block;
let n = 0;
const call = (name: string, input: object = {}) => ({ type: "tool_use", id: `toolu_s${++n}`, name, input }) as unknown as Block;

function model(...answers: Anthropic.Beta.BetaMessage[]) {
  const seen: Anthropic.Beta.Messages.MessageCreateParamsNonStreaming[] = [];
  const create: CreateMessage = async (p) => {
    seen.push(structuredClone(p));
    const a = answers.shift();
    if (!a) throw new Error("scripted model ran out of answers");
    return a;
  };
  return { create, seen, left: () => answers.length };
}

let seq = 0;
const newChatId = () => `94000${String(++seq).padStart(4, "0")}`;

/** A fake team chat: records what was sent, hands out message ids. */
function team(id = 7000) {
  const sent: string[] = [];
  let next = id;
  return { sent, notifyTeam: async (html: string) => (sent.push(html), ++next) };
}

describe("Sabaq sales agent", () => {
  it("answers, asks for the phone with a button, sends the lead to the team — and the phone never reaches the model", async () => {
    const chat = await openSalesChat(newChatId(), { name: "Dilnoza Karimova", username: "dilnoza_k" });
    const t = team();
    const m = model(
      msg([text("Assalomu alaykum! Men Sabaqning AI yordamchisiman. Sizga qanday yordam bera olaman?")], "end_turn"),
      msg([text("Ha, 150 tagacha o'quvchi — Start tarifi.")], "end_turn"),
      msg([call("request_phone")], "tool_use"),
      msg([text("Pastdagi tugma bilan raqamingizni yuboring, jamoamiz bog'lanadi.")], "end_turn"),
      msg([call("notify_team", { kind: "lead", summary: "Dilnoza, markaz egasi, «Bilim» markazi, ~120 o'quvchi, boshlamoqchi." })], "tool_use"),
      msg([text("Rahmat! Jamoamiz tez orada bog'lanadi.")], "end_turn"),
    );
    const turn = (s: string) => handleSalesMessage({ chatRowId: chat.id, text: s, locale: "uz", notifyTeam: t.notifyTeam, create: m.create });

    expect((await turn(SALES_MARK.start)).replies[0]).toContain("AI yordamchi");
    // the prompt is Sabaq's, not a center's
    const system = (m.seen[0].system as Anthropic.Beta.BetaTextBlockParam[])[0].text;
    expect(system).toContain("o'qituvchining AI yordamchisi");
    expect(m.seen[0].tools!.map((x) => (x as { name: string }).name)).toEqual(["request_phone", "notify_team"]);

    expect((await turn("120 ta o'quvchimiz bor, qaysi tarif?")).askPhone).toBe(false);
    const asked = await turn("Boshlamoqchiman");
    expect(asked.askPhone).toBe(true);
    expect((await db.salesChat.findUniqueOrThrow({ where: { id: chat.id } })).awaitingPhone).toBe(true);

    await recordSalesPhone(chat.id, "998901112233");
    const done = await turn(SALES_MARK.phone);
    expect(done.replies).toEqual(["Rahmat! Jamoamiz tez orada bog'lanadi."]);
    expect(t.sent).toHaveLength(1);
    expect(t.sent[0]).toContain("Dilnoza Karimova");
    expect(t.sent[0]).toContain("@dilnoza_k");
    expect(t.sent[0]).toContain("+998901112233");
    expect(t.sent[0]).toContain("«Bilim» markazi");
    expect(m.left()).toBe(0);
    // the number went to the team, never to the model
    expect(JSON.stringify(m.seen)).not.toContain("998901112233");

    const saved = await db.salesChat.findUniqueOrThrow({ where: { id: chat.id } });
    expect(saved.teamMessageIds).toEqual([7001]);
    expect(saved.inputTokens).toBe(6000);
    expect((await salesChatOfTeamMessage(7001))?.id).toBe(chat.id);
    expect(await salesChatOfTeamMessage(1)).toBeNull();
  });

  it("no team chat: the tool tells the model, which tells the person", async () => {
    const chat = await openSalesChat(newChatId());
    const m = model(msg([call("notify_team", { kind: "question", summary: "Integratsiya bormi?" })], "tool_use"), msg([text("Jamoa keyinroq bog'lanadi.")], "end_turn"));
    const r = await handleSalesMessage({ chatRowId: chat.id, text: "1C bilan integratsiya bormi?", locale: "uz", notifyTeam: async () => null, create: m.create });
    expect(r.replies).toEqual(["Jamoa keyinroq bog'lanadi."]);
    const results = m.seen[1].messages.filter((x) => x.role === "user").at(-1)!.content as Anthropic.Beta.BetaToolResultBlockParam[];
    expect(results[0].is_error).toBe(true);
  });

  it("over the monthly cap: a polite pause, no model call", async () => {
    const month = monthKey(todayISO());
    await db.salesUsage.upsert({ where: { month }, create: { month, inputTokens: 999_000_000 }, update: { inputTokens: 999_000_000 } });
    try {
      const chat = await openSalesChat(newChatId());
      const m = model();
      const r = await handleSalesMessage({ chatRowId: chat.id, text: "Salom", locale: "ru", notifyTeam: async () => 1, create: m.create });
      expect(r.replies).toEqual([salesText("paused", "ru")]);
      expect(m.seen).toHaveLength(0);
    } finally {
      await db.salesUsage.delete({ where: { month } });
    }
  });

  it("a conversation idle for weeks is no longer picked up by a contact share", async () => {
    const chatId = newChatId();
    await openSalesChat(chatId, {}, new Date(Date.now() - 30 * 86_400_000));
    expect(await activeSalesChat(chatId)).toBeNull();
    await openSalesChat(chatId);
    expect(await activeSalesChat(chatId)).not.toBeNull();
  });
});
