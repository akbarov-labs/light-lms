// Server operator: switch a center's AI lead agent on or off, set its rules, see its usage.
//   npx tsx scripts/agent.ts on demo
//   npx tsx scripts/agent.ts off demo
//   npx tsx scripts/agent.ts rules demo "Chegirma yo'q. To'lov oyma-oy, oyning 5-sanasigacha."
//   npx tsx scripts/agent.ts cap demo 2000000
//   npx tsx scripts/agent.ts status demo
// The agent also needs ANTHROPIC_API_KEY in the worker's environment. It sends conversations to Anthropic
// (USA): switch it on only for centers that agreed to that (DEPLOY.md §0). Every change is audited.
// Customers reach it at https://t.me/<bot username>?start=<center slug>.
import type { Prisma } from "../src/generated/prisma/client";
import { db } from "../src/lib/db";
import { audit } from "../src/lib/audit";
import { readSettings } from "../src/lib/settings";
import { monthKey, todayISO } from "../src/lib/dates";
import { anthropicApiKey } from "../src/lib/env";
import { capTokens } from "../src/lib/agent/service";

async function main() {
  const [cmd, slug, value] = process.argv.slice(2);
  if (!["on", "off", "rules", "cap", "status"].includes(cmd ?? "") || !slug) {
    console.error('usage: tsx scripts/agent.ts on|off|status <slug> · rules <slug> "<text>" · cap <slug> <tokens per month>');
    process.exit(1);
  }
  const center = await db.center.findUnique({ where: { slug } });
  if (!center) throw new Error(`no center with slug "${slug}"`);
  const settings = readSettings(center.settings);
  const before = settings.agent;
  const agent = { ...before };
  if (cmd === "on") agent.enabled = true;
  if (cmd === "off") agent.enabled = false;
  if (cmd === "rules") agent.rules = (value ?? "").slice(0, 4000);
  if (cmd === "cap") {
    const n = Number(value);
    if (!Number.isInteger(n) || n < 0) throw new Error("cap must be a whole number of tokens");
    agent.monthlyTokenCap = n;
  }
  if (cmd !== "status") {
    await db.$transaction(async (tx) => {
      await tx.center.update({ where: { id: center.id }, data: { settings: { ...settings, agent } as unknown as Prisma.InputJsonValue } });
      await audit(tx, { centerId: center.id, userId: null, actor: "SYSTEM", entity: "Center", entityId: center.id, action: `agent.${cmd}`, before, after: agent });
    });
  }
  const usage = await db.agentUsage.findUnique({ where: { centerId_month: { centerId: center.id, month: monthKey(todayISO()) } } });
  console.log(`${center.name} (${slug}): agent ${agent.enabled ? "ON" : "off"}${anthropicApiKey() ? "" : " — ANTHROPIC_API_KEY is not set here, so it will not answer"}`);
  console.log(`monthly cap: ${agent.monthlyTokenCap} tokens · this month: ${usage ? capTokens(usage) : 0} counted (cache reads at 1/10) in ${usage?.calls ?? 0} calls`);
  if (usage) console.log(`  input ${usage.inputTokens} · output ${usage.outputTokens} · cache read ${usage.cacheReadTokens} · cache write ${usage.cacheWriteTokens}`);
  console.log(`rules: ${agent.rules || "(none)"}`);
}

main()
  .catch((e) => {
    console.error(e.message ?? e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
