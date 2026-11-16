// The AI agent's conversation with this lead, as staff read it: what the person wrote, what the agent
// answered, and which tools it used. Tool results and system markers are shown quietly, not as chat.
import type { Prisma } from "@/generated/prisma/client";
import type { TFn } from "@/lib/i18n";
import { formatDateTime } from "@/lib/dates";
import { Card } from "@/components/ui";
import { isMarker, parseStaffMarker } from "@/lib/agent/markers";

type Row = { who: "client" | "agent" | "staff" | "system" | "tool"; text: string; staff?: string };

function rows(messages: Prisma.JsonValue): Row[] {
  if (!Array.isArray(messages)) return [];
  const out: Row[] = [];
  for (const m of messages) {
    if (!m || typeof m !== "object" || Array.isArray(m)) continue;
    const role = m.role;
    const content = m.content;
    const blocks: Prisma.JsonValue[] = typeof content === "string" ? [{ type: "text", text: content }] : Array.isArray(content) ? content : [];
    for (const b of blocks) {
      if (!b || typeof b !== "object" || Array.isArray(b)) continue;
      if (b.type === "text" && typeof b.text === "string" && b.text.trim()) {
        const text = b.text.trim();
        const staff = role === "user" ? parseStaffMarker(text) : null;
        if (staff) out.push({ who: "staff", text: staff.text, staff: staff.staff });
        else out.push({ who: role === "user" && isMarker(text) ? "system" : role === "user" ? "client" : "agent", text });
      } else if (b.type === "tool_use" && typeof b.name === "string") {
        out.push({ who: "tool", text: `🔧 ${b.name}` });
      }
    }
  }
  return out;
}

export interface TranscriptChat {
  id: string;
  messages: Prisma.JsonValue;
  phoneSource: string | null;
  inputTokens: number;
  outputTokens: number;
  lastMessageAt: Date;
}

export function AgentTranscript({ chat, t }: { chat: TranscriptChat; t: TFn }) {
  const list = rows(chat.messages);
  return (
    <Card title={t("agent.transcript")}>
      <p className="mb-3 text-xs text-zinc-500">
        {formatDateTime(chat.lastMessageAt)}
        {chat.phoneSource && <> · {t(chat.phoneSource === "telegram" ? "agent.phoneTelegram" : "agent.phoneTyped")}</>}
        {" · "}
        {t("agent.tokens", { input: chat.inputTokens, output: chat.outputTokens })}
      </p>
      <ul className="space-y-2 text-sm">
        {list.map((r, i) =>
          r.who === "tool" || r.who === "system" ? (
            <li key={i} className="text-xs text-zinc-500">{r.text}</li>
          ) : (
            <li key={i} className={r.who === "client" ? "ml-8 rounded-lg border border-zinc-200 p-3" : r.who === "staff" ? "mr-8 rounded-lg bg-amber-50 p-3" : "mr-8 rounded-lg bg-zinc-50 p-3"}>
              <div className="mb-1 text-xs text-zinc-500">{r.who === "agent" ? t("agent.actor") : r.who === "staff" ? `${t("agent.staff")}: ${r.staff}` : t("agent.client")}</div>
              <div className="whitespace-pre-line text-zinc-800">{r.text}</div>
            </li>
          ),
        )}
      </ul>
    </Card>
  );
}
