import { notFound } from "next/navigation";
import { requireStaff } from "@/lib/ctx";
import { db } from "@/lib/db";
import { formatDateTime } from "@/lib/dates";
import { Badge, Card, type Tone } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { botLink, managedBotsOn } from "@/lib/managed-bots/service";
import { changeOwnBotAction, createOwnBotAction, tellFamiliesAction } from "./actions";

export const dynamic = "force-dynamic";

const TONE: Record<string, Tone> = { TESTING: "amber", ACTIVE: "green", PAUSED: "gray", GONE: "red" };

export default async function TelegramBotSettings() {
  const ctx = await requireStaff("settings");
  if (!managedBotsOn()) notFound();
  const { t } = ctx;
  const center = await db.center.findUniqueOrThrow({ where: { id: ctx.centerId }, select: { ownBotAllowed: true, bot: true } });
  const bot = center.bot;
  const owner = ctx.role === "OWNER";
  const started = bot ? await db.botChat.count({ where: { botId: bot.botId, blockedAt: null } }) : 0;
  const canCreate = center.ownBotAllowed && (!bot || bot.status === "GONE");

  return (
    <div className="space-y-5">
      <Card title={t("ownBot.title")}>
        <p className="max-w-2xl text-sm text-zinc-600">{t("ownBot.intro")}</p>

        {!center.ownBotAllowed && !bot && <p className="mt-4 rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-700">{t("ownBot.notAllowed")}</p>}

        {bot && (
          <dl className="mt-4 grid max-w-2xl gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
            <dt className="text-zinc-500">{t("ownBot.link")}</dt>
            <dd>
              <a href={botLink(bot)} target="_blank" rel="noreferrer" className="font-medium text-zinc-900 underline decoration-zinc-300 underline-offset-2 hover:decoration-zinc-900">
                @{bot.username}
              </a>
              <span className="ml-2 text-zinc-500">{bot.name}</span>
            </dd>
            <dt className="text-zinc-500">{t("ownBot.status")}</dt>
            <dd>
              <Badge tone={TONE[bot.status]}>{t(`ownBot.status.${bot.status}`)}</Badge>
              <span className="tnum ml-2 text-xs text-zinc-500">{formatDateTime(bot.updatedAt)}</span>
            </dd>
            {bot.status !== "GONE" && (
              <>
                <dt className="text-zinc-500">{t("ownBot.started")}</dt>
                <dd className="tnum">{started}</dd>
              </>
            )}
            {bot.lastError && (
              <>
                <dt className="text-zinc-500">{t("ownBot.lastError")}</dt>
                <dd className="break-words text-xs text-zinc-600">{bot.lastError}</dd>
              </>
            )}
          </dl>
        )}

        {bot && (
          <p className="mt-4 max-w-2xl rounded-lg bg-zinc-50 px-3 py-2 text-sm text-zinc-700">
            {t(bot.status === "TESTING" ? "ownBot.testingHint" : bot.status === "ACTIVE" ? "ownBot.activeHint" : bot.status === "PAUSED" ? "ownBot.pausedHint" : "ownBot.goneHint")}
          </p>
        )}

        {!owner && (canCreate || bot) && <p className="mt-4 text-sm text-zinc-500">{t("ownBot.ownerOnly")}</p>}

        {owner && canCreate && (
          <ActionForm action={createOwnBotAction} className="mt-4 space-y-2">
            <SubmitButton>{t("ownBot.create")}</SubmitButton>
            <p className="max-w-2xl text-xs text-zinc-500">{t("ownBot.createHint")}</p>
          </ActionForm>
        )}

        {owner && bot && bot.status !== "GONE" && (
          <div className="mt-4 flex flex-wrap gap-2">
            {bot.status === "TESTING" && (
              <ActionForm action={changeOwnBotAction}>
                <input type="hidden" name="change" value="launch" />
                <SubmitButton>{t("ownBot.launch")}</SubmitButton>
              </ActionForm>
            )}
            {bot.status === "PAUSED" && center.ownBotAllowed && (
              <ActionForm action={changeOwnBotAction}>
                <input type="hidden" name="change" value="resume" />
                <SubmitButton>{t("ownBot.resume")}</SubmitButton>
              </ActionForm>
            )}
            {(bot.status === "TESTING" || bot.status === "ACTIVE") && (
              <ActionForm action={changeOwnBotAction}>
                <input type="hidden" name="change" value="pause" />
                <SubmitButton variant="secondary" confirm={t("ownBot.pauseConfirm")}>{t("ownBot.pause")}</SubmitButton>
              </ActionForm>
            )}
          </div>
        )}
      </Card>

      {owner && bot?.status === "ACTIVE" && (
        <Card title={t("ownBot.tellFamilies")}>
          <ActionForm action={tellFamiliesAction} quiet className="space-y-3">
            <p className="max-w-2xl text-sm text-zinc-600">{t("ownBot.tellFamiliesHint")}</p>
            <SubmitButton variant="secondary">{t("ownBot.tellFamilies")}</SubmitButton>
          </ActionForm>
        </Card>
      )}
    </div>
  );
}
