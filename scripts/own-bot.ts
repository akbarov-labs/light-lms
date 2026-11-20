// Server operator: a center's own Telegram bot (managed bots, docs/TELEGRAM-MANAGED-BOTS.md) without the web UI.
//   npx tsx scripts/own-bot.ts status demo
//   npx tsx scripts/own-bot.ts allow demo        (platform allow-list; "deny" removes it)
//   npx tsx scripts/own-bot.ts link demo         (creation link for the center's OWNER, 10 minutes)
//   npx tsx scripts/own-bot.ts launch|pause|resume demo
// Needs TELEGRAM_MANAGED_BOTS=true and TELEGRAM_BOT_TOKEN (the shared bot, with Bot Management Mode on in
// @BotFather). Every change is audited.
import { db } from "../src/lib/db";
import { audit } from "../src/lib/audit";
import { managerCall } from "../src/lib/managed-bots/api";
import { CODE_PREFIX, changeBotStatus, createBotRequest, managedBotsOn } from "../src/lib/managed-bots/service";

const CMDS = ["status", "allow", "deny", "link", "launch", "pause", "resume"] as const;

async function main() {
  const [cmd, slug] = process.argv.slice(2) as [(typeof CMDS)[number], string];
  if (!CMDS.includes(cmd) || !slug) {
    console.error(`usage: tsx scripts/own-bot.ts ${CMDS.join("|")} <slug>`);
    process.exit(1);
  }
  const center = await db.center.findUnique({ where: { slug }, include: { bot: true } });
  if (!center) throw new Error(`no center with slug "${slug}"`);
  if (cmd === "allow" || cmd === "deny") {
    const allow = cmd === "allow";
    await db.$transaction(async (tx) => {
      await tx.center.update({ where: { id: center.id }, data: { ownBotAllowed: allow } });
      await audit(tx, { centerId: center.id, actor: "SYSTEM", entity: "Center", entityId: center.id, action: "platform.ownBot", before: { ownBotAllowed: center.ownBotAllowed }, after: { ownBotAllowed: allow, by: "own-bot script" } });
    });
  } else if (cmd === "link") {
    if (!managedBotsOn()) throw new Error("set TELEGRAM_MANAGED_BOTS=true and TELEGRAM_BOT_TOKEN");
    const owner = await db.user.findFirst({ where: { centerId: center.id, role: "OWNER", archivedAt: null }, orderBy: { createdAt: "asc" } });
    if (!owner) throw new Error("the center has no active OWNER");
    const me = await managerCall<{ username: string; can_manage_bots?: boolean }>("getMe");
    if (!me.can_manage_bots) console.warn(`warning: @${me.username} has Bot Management Mode off in @BotFather — Telegram will not offer the button`);
    const code = await createBotRequest(center.id, owner.id);
    console.log(`open as ${owner.name} (their linked Telegram account), within 10 minutes:\nhttps://t.me/${me.username}?start=${CODE_PREFIX}${code}`);
  } else if (cmd !== "status") {
    const owner = await db.user.findFirst({ where: { centerId: center.id, role: "OWNER", archivedAt: null }, orderBy: { createdAt: "asc" } });
    await changeBotStatus(center.id, owner?.id ?? "", cmd);
  }
  const fresh = await db.center.findUniqueOrThrow({ where: { id: center.id }, include: { bot: true } });
  const started = fresh.bot ? await db.botChat.count({ where: { botId: fresh.bot.botId, blockedAt: null } }) : 0;
  console.log(
    JSON.stringify(
      { center: fresh.slug, ownBotAllowed: fresh.ownBotAllowed, managedBotsOn: managedBotsOn(), bot: fresh.bot && { username: fresh.bot.username, botId: fresh.bot.botId, status: fresh.bot.status, lastError: fresh.bot.lastError, started } },
      null,
      2,
    ),
  );
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
