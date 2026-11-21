import Link from "next/link";
import { notFound } from "next/navigation";
import { MessagesSquare } from "lucide-react";
import type { BotChatKind } from "@/generated/prisma/client";
import { requireCtx } from "@/lib/ctx";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { BOT_LOG_DAYS, conversation, listConversations } from "@/lib/services/bot-log";
import { Badge, Card, cx, EmptyState, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";

const KINDS: BotChatKind[] = ["AGENT", "TUTOR"];
const isKind = (k: string | undefined): k is BotChatKind => KINDS.includes(k as BotChatKind);
const FROM_STYLE = {
  PERSON: "mr-auto bg-zinc-100 text-zinc-900",
  BOT: "ml-auto bg-[rgb(var(--accent))]/10 text-zinc-900",
  STAFF: "ml-auto bg-amber-50 text-amber-950",
} as const;

/**
 * The AI chats as the person saw them (src/lib/services/bot-log.ts). Owners read their own center: these are
 * children's and parents' messages, so not managers or admins. Platform admins open any center from
 * /platform (?center=<id>) to help with a bot's answers.
 */
export default async function ConversationsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const ctx = await requireCtx();
  const { t } = ctx;
  const sp = await searchParams;
  const other = sp.center && sp.center !== ctx.centerId ? sp.center : null;
  if (other ? !ctx.isPlatformAdmin : ctx.role !== "OWNER" && !ctx.isPlatformAdmin) notFound();
  const centerId = other ?? ctx.centerId;
  const otherCenter = other ? await db.center.findUnique({ where: { id: other }, select: { name: true } }) : null;
  if (other && !otherCenter) notFound();

  const kind = isKind(sp.k) ? sp.k : undefined;
  const chatKind = isKind(sp.ck) ? sp.ck : undefined;
  const chatId = sp.chat && /^-?\d{1,20}$/.test(sp.chat) && chatKind ? sp.chat : null;
  const href = (p: Record<string, string | undefined>) => {
    const q = new URLSearchParams(Object.entries({ center: other ?? undefined, k: kind, ...p }).filter((e): e is [string, string] => !!e[1]));
    return `/conversations${q.size ? `?${q}` : ""}`;
  };

  const [list, messages, agentChat] = await Promise.all([
    listConversations(centerId, { kind }),
    chatId && chatKind ? conversation(centerId, chatId, chatKind) : Promise.resolve(null),
    // the lead page, for the center's own staff only
    chatId && chatKind === "AGENT" && !other ? db.agentChat.findUnique({ where: { centerId_chatId: { centerId, chatId } }, select: { leadId: true } }) : Promise.resolve(null),
  ]);
  const picked = chatId ? list.find((c) => c.chatId === chatId && c.kind === chatKind) : undefined;

  return (
    <>
      <PageHeader
        title={t("nav.conversations")}
        subtitle={otherCenter ? t("conv.center", { name: otherCenter.name }) : t("conv.subtitle", { days: BOT_LOG_DAYS })}
      />
      <nav className="mb-4 flex flex-wrap gap-1" aria-label={t("common.filter")}>
        {[undefined, ...KINDS].map((k) => (
          <Link
            key={k ?? "all"}
            href={href({ k })}
            aria-current={k === kind ? "page" : undefined}
            className={cx("rounded-lg px-3 py-1.5 text-sm", k === kind ? "bg-zinc-900 text-white" : "text-zinc-600 hover:bg-zinc-100")}
          >
            {k ? t(`conv.kind.${k}`) : t("conv.all")}
          </Link>
        ))}
      </nav>
      {list.length === 0 ? (
        <Card>
          <EmptyState icon={<MessagesSquare className="h-6 w-6 text-zinc-400" strokeWidth={1.5} />}>{t("conv.none")}</EmptyState>
        </Card>
      ) : (
        <div className="grid items-start gap-4 lg:grid-cols-[22rem_1fr]">
          <Card pad={false}>
            <ul className="divide-y divide-zinc-100">
              {list.map((c) => {
                const on = c.chatId === chatId && c.kind === chatKind;
                return (
                  <li key={`${c.kind}:${c.chatId}`}>
                    <Link href={href({ chat: c.chatId, ck: c.kind })} aria-current={on ? "true" : undefined} className={cx("block px-4 py-3 hover:bg-zinc-50", on && "bg-zinc-50")}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-zinc-900">{c.name ?? t("conv.unknown")}</span>
                        <span className="tnum shrink-0 text-xs text-zinc-500">{formatDateTime(c.lastAt)}</span>
                      </div>
                      <div className="mt-1 flex items-center gap-2">
                        <Badge tone={c.kind === "AGENT" ? "blue" : "violet"}>{t(`conv.kind.${c.kind}`)}</Badge>
                        <span className="tnum text-xs text-zinc-500">{t("conv.messages", { n: c.messages })}</span>
                      </div>
                      <p className="mt-1 line-clamp-2 text-[13px] text-zinc-600">
                        {c.lastFrom !== "PERSON" && <span className="text-zinc-400">{t(`conv.from.${c.lastFrom}`)}: </span>}
                        {c.lastText}
                      </p>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </Card>
          <Card
            title={picked ? `${picked.name ?? t("conv.unknown")} · ${t(`conv.kind.${picked.kind}`)}` : undefined}
            actions={agentChat?.leadId ? <Link href={`/leads/${agentChat.leadId}`} className="text-sm text-zinc-600 underline-offset-2 hover:underline">{t("conv.toLead")}</Link> : undefined}
          >
            {!messages || messages.length === 0 ? (
              <EmptyState compact>{t("conv.pick")}</EmptyState>
            ) : (
              <ol className="flex flex-col gap-2">
                {messages.map((m) => (
                  <li key={m.id} className={cx("max-w-[85%] rounded-2xl px-3.5 py-2", FROM_STYLE[m.from])}>
                    <div className="mb-0.5 flex items-center gap-2 text-[11px] text-zinc-500">
                      <span>{m.from === "STAFF" && m.name ? m.name : t(`conv.from.${m.from}`)}</span>
                      <span className="tnum">{formatDateTime(m.createdAt)}</span>
                    </div>
                    <p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{m.text}</p>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
