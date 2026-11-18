// A center's own bot (managed bots, docs/TELEGRAM-MANAGED-BOTS.md) on the real database: the creation flow
// through the shared bot, what a center bot shows, which bot a queued message goes through, Settings status
// changes, "tell families" and the Mini App. Telegram is replaced by recorders. Run: npm run test:integration
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import bcrypt from "bcryptjs";
import type { Bot } from "grammy";
import type { Update } from "grammy/types";
import { db } from "@/lib/db";
import { createBot } from "@/worker/bot";
import { B } from "@/worker/bot/texts";
import { linkChat } from "@/worker/bot/data";
import { setBotApiTransport } from "@/lib/managed-bots/api";
import { CODE_PREFIX, changeBotStatus, createBotRequest, onManagedBotUpdate, openBotRequest, reachableByCenterBot, routeBotFor, tellFamilies } from "@/lib/managed-bots/service";
import { processNotifications, routedSender, defaultRouter, type Sender } from "@/worker/notifications";
import { initDataHash } from "@/lib/telegram-webapp";
import { POST } from "@/app/api/tg/data/route";
import { UserError } from "@/lib/user-error";

const MANAGER = "1:manager";
const BOT_ID = 880000001;
const BOT_TOKEN = `${BOT_ID}:center-token`;
const OWNER = 940000001; // owner of center A, linked in the shared bot
const PARENT = 940000002; // children at A and at B
const STRANGER = 940000003;
const OWNER_B = 940000004;
const PHONE = { owner: "998937770101", parent: "998937770202", ownerB: "998937770303" };

let a = "";
let b = "";
let ownerId = "";
let update = 1;
let sharedBot: Bot;
let centerBot: Bot | null = null;
let calls: { bot: string; method: string; payload: Record<string, unknown> }[] = [];
let managerCalls: { token: string; method: string; params: Record<string, unknown> }[] = [];
const saved = { token: process.env.TELEGRAM_BOT_TOKEN, flag: process.env.TELEGRAM_MANAGED_BOTS, app: process.env.APP_URL };

const from = (id: number) => ({ id, is_bot: false, first_name: "T", language_code: "uz" });
const msg = (user: number, extra: Record<string, unknown>): Update =>
  ({ update_id: update++, message: { message_id: update, date: 0, chat: { id: user, type: "private", first_name: "T" }, from: from(user), ...extra } }) as unknown as Update;
const command = (user: number, cmd: string, arg = "") =>
  msg(user, { text: `/${cmd}${arg ? ` ${arg}` : ""}`, entities: [{ type: "bot_command", offset: 0, length: cmd.length + 1 }] });

function recorder(bot: Bot, name: string, me: { id: number; username: string }) {
  bot.botInfo = { id: me.id, is_bot: true, first_name: name, username: me.username, can_join_groups: false, can_read_all_group_messages: false, supports_inline_queries: false, can_connect_to_business: false, has_main_web_app: false } as Bot["botInfo"];
  bot.api.config.use(async (_prev, method, payload) => {
    calls.push({ bot: name, method, payload: payload as Record<string, unknown> });
    const result = method === "sendMessage" ? { message_id: 1, date: 0, chat: { id: 1, type: "private" }, text: "" } : true;
    return { ok: true, result } as never;
  });
}
async function send(bot: Bot, u: Update) {
  calls = [];
  await bot.handleUpdate(u);
  return calls;
}
const lastText = () => calls.filter((c) => c.method === "sendMessage").at(-1)?.payload.text as string;

beforeAll(async () => {
  process.env.TELEGRAM_BOT_TOKEN = MANAGER;
  process.env.TELEGRAM_MANAGED_BOTS = "true";
  process.env.APP_URL = "https://lms.example";
  setBotApiTransport(async (token, method, params) => {
    managerCalls.push({ token, method, params });
    if (method === "getManagedBotToken") return BOT_TOKEN;
    return true;
  });
  const hash = await bcrypt.hash("x-password-1", 4);
  const ca = await db.center.create({ data: { name: "Ilm Markazi", slug: "mb-ilm", ownBotAllowed: true } });
  const cb = await db.center.create({ data: { name: "Boshqa Markaz", slug: "mb-other", ownBotAllowed: true } });
  a = ca.id;
  b = cb.id;
  ownerId = (await db.user.create({ data: { centerId: a, phone: PHONE.owner, name: "Owner A", passwordHash: hash, role: "OWNER", perms: [] } })).id;
  await db.user.create({ data: { centerId: b, phone: PHONE.ownerB, name: "Owner B", passwordHash: hash, role: "OWNER", perms: [] } });
  for (const [centerId, name] of [[a, "Ali"], [b, "Vali"]] as const) {
    const fam = await db.family.create({ data: { centerId, name: `${name}lar` } });
    await db.guardian.create({ data: { familyId: fam.id, name: "Ona", phone: PHONE.parent, isPrimary: true } });
    await db.student.create({ data: { centerId, familyId: fam.id, firstName: name, lastName: "Karimov" } });
  }
  await linkChat(String(OWNER), PHONE.owner, "uz");
  await linkChat(String(OWNER_B), PHONE.ownerB, "uz");
  await linkChat(String(PARENT), PHONE.parent, "uz");
  sharedBot = createBot(MANAGER);
  recorder(sharedBot, "shared", { id: 1, username: "lms_shared_bot" });
});

afterAll(() => {
  setBotApiTransport(null);
  process.env.TELEGRAM_BOT_TOKEN = saved.token;
  process.env.TELEGRAM_MANAGED_BOTS = saved.flag;
  process.env.APP_URL = saved.app;
});

beforeEach(() => {
  managerCalls = [];
});

describe("creating a center bot", () => {
  it("a code works only for the OWNER's linked chat, while fresh, and for allowed centers", async () => {
    const code = await createBotRequest(a, ownerId);
    expect(await openBotRequest(code, String(PARENT))).toEqual({ ok: false, reason: "notOwner" });
    expect(await openBotRequest(code, String(OWNER_B))).toEqual({ ok: false, reason: "notOwner" });
    expect(await openBotRequest("garbage", String(OWNER))).toEqual({ ok: false, reason: "expired" });
    const old = await createBotRequest(a, ownerId, new Date(Date.now() - 11 * 60_000));
    expect(await openBotRequest(old, String(OWNER))).toEqual({ ok: false, reason: "expired" });
    await db.center.update({ where: { id: a }, data: { ownBotAllowed: false } });
    const c2 = await createBotRequest(a, ownerId);
    expect(await openBotRequest(c2, String(OWNER))).toEqual({ ok: false, reason: "off" });
    await db.center.update({ where: { id: a }, data: { ownBotAllowed: true } });
  });

  it("/start nb_<code> in the shared bot shows Telegram's create-bot button with the center's name", async () => {
    const code = await createBotRequest(a, ownerId);
    await send(sharedBot, command(OWNER, "start", `${CODE_PREFIX}${code}`));
    const reply = calls.find((c) => c.method === "sendMessage")!;
    const button = (reply.payload.reply_markup as { keyboard: { request_managed_bot?: { suggested_name: string; suggested_username: string } }[][] }).keyboard[0][0];
    expect(button.request_managed_bot).toMatchObject({ suggested_name: "Ilm Markazi", suggested_username: "mb_ilm_bot" });
    expect((await db.botCreateRequest.findUnique({ where: { code } }))?.chatId).toBe(String(OWNER));
  });

  it("a managed_bot update from someone else attaches nothing", async () => {
    const r = await onManagedBotUpdate({ user: { id: STRANGER }, bot: { id: 1234, username: "rogue_bot", first_name: "Rogue" } });
    expect(r.kind).toBe("ignored");
    expect(await db.centerBot.count({ where: { centerId: a } })).toBe(0);
  });

  it("the owner's managed_bot update attaches the bot in TESTING, limited to the owner; the code is spent", async () => {
    calls = [];
    await sharedBot.handleUpdate({ update_id: update++, managed_bot: { user: from(OWNER), bot: { id: BOT_ID, is_bot: true, first_name: "Ilm bot", username: "ilm_markazi_bot" } } } as unknown as Update);
    const bot = await db.centerBot.findUnique({ where: { botId: String(BOT_ID) } });
    expect(bot).toMatchObject({ centerId: a, status: "TESTING", ownerTgId: String(OWNER), username: "ilm_markazi_bot" });
    expect(managerCalls).toContainEqual({ token: MANAGER, method: "setManagedBotAccessSettings", params: { user_id: BOT_ID, is_access_restricted: true } });
    expect(await db.botCreateRequest.count({ where: { centerId: a, usedAt: null, chatId: String(OWNER) } })).toBe(0);
    expect(await db.auditLog.count({ where: { entity: "CenterBot", entityId: String(BOT_ID), action: "bot.create" } })).toBe(1);
  });

  it("the managed_bot_created message right after is no change, and the owner is told it is ready", async () => {
    await send(sharedBot, msg(OWNER, { managed_bot_created: { bot: { id: BOT_ID, is_bot: true, first_name: "Ilm bot", username: "ilm_markazi_bot" } } }));
    expect(lastText()).toBe(B.nbReady.uz.replace("{bot}", "ilm_markazi_bot"));
  });

  it("a second code for a center that has a bot is refused", async () => {
    const code = await createBotRequest(a, ownerId);
    expect(await openBotRequest(code, String(OWNER))).toEqual({ ok: false, reason: "hasBot" });
  });
});

describe("the center bot", () => {
  beforeAll(() => {
    centerBot = createBot(BOT_TOKEN, { scope: { centerId: a, botId: String(BOT_ID) } });
    recorder(centerBot, "center", { id: BOT_ID, username: "ilm_markazi_bot" });
  });

  it("a parent linked in the shared bot is already linked here, and sees only this center", async () => {
    await send(centerBot!, command(PARENT, "start"));
    expect(lastText()).toBe(B.linked.uz);
    await send(centerBot!, msg(PARENT, { text: B.balanceBtn.uz }));
    expect(lastText()).toContain("Ali");
    expect(lastText()).not.toContain("Vali");
    expect(await db.botChat.findUnique({ where: { botId_chatId: { botId: String(BOT_ID), chatId: String(PARENT) } } })).toMatchObject({ blockedAt: null });
  });

  it("the shared bot still shows both centers", async () => {
    await send(sharedBot, msg(PARENT, { text: B.balanceBtn.uz }));
    expect(lastText()).toContain("Ali");
    expect(lastText()).toContain("Vali");
  });

  it("another center's owner gets no menu here, and a center slug in /start is ignored", async () => {
    await send(centerBot!, command(OWNER_B, "start", "mb-other"));
    expect(lastText()).toBe(B.welcome.uz);
  });

  it("a contact share with a number known only at another center is 'not found' here", async () => {
    const hash = await bcrypt.hash("x", 4);
    await db.user.create({ data: { centerId: b, phone: "998937770404", name: "B teacher", passwordHash: hash, role: "TEACHER", isTeacher: true, perms: [] } });
    await send(centerBot!, msg(STRANGER, { contact: { phone_number: "998937770404", first_name: "T", user_id: STRANGER } }));
    expect(lastText()).toBe(B.notFound.uz);
  });

  it("a parent who blocks the center bot is marked blocked", async () => {
    await send(centerBot!, { update_id: update++, my_chat_member: { chat: { id: PARENT, type: "private", first_name: "T" }, from: from(PARENT), date: 0, old_chat_member: { status: "member", user: from(BOT_ID) }, new_chat_member: { status: "kicked", user: from(BOT_ID), until_date: 0 } } } as unknown as Update);
    expect((await db.botChat.findUnique({ where: { botId_chatId: { botId: String(BOT_ID), chatId: String(PARENT) } } }))?.blockedAt).not.toBeNull();
    await db.botChat.update({ where: { botId_chatId: { botId: String(BOT_ID), chatId: String(PARENT) } }, data: { blockedAt: null } });
  });
});

describe("routing queued messages", () => {
  it("TESTING carries nothing; ACTIVE carries messages to people who started it", async () => {
    expect(await routeBotFor(a, String(PARENT))).toBeNull();
    await changeBotStatus(a, ownerId, "launch");
    expect(managerCalls).toContainEqual({ token: MANAGER, method: "setManagedBotAccessSettings", params: { user_id: BOT_ID, is_access_restricted: false } });
    expect(await routeBotFor(a, String(PARENT))).toBe(String(BOT_ID));
    expect(await routeBotFor(a, String(STRANGER + 100))).toBeNull(); // never started it
    expect(await routeBotFor(b, String(PARENT))).toBeNull(); // center B has no bot
  });

  it("a launched bot can't be launched again", async () => {
    await expect(changeBotStatus(a, ownerId, "launch")).rejects.toBeInstanceOf(UserError);
  });

  it("the queue records which bot delivered; 403 from the center bot falls back and keeps the chat linked", async () => {
    await db.notification.updateMany({ where: { status: { in: ["PENDING", "SENDING"] } }, data: { status: "PENDING", lockedAt: null, nextAttemptAt: new Date(Date.now() + 365 * 86_400_000) } });
    let centerFails = false;
    const delivered: string[] = [];
    const shared: Sender = async (chatId) => void delivered.push(`shared:${chatId}`);
    const router = {
      ...defaultRouter,
      sender: async (botId: string): Promise<Sender> => async (chatId) => {
        if (centerFails) throw Object.assign(new Error("Forbidden: bot was blocked by the user"), { error_code: 403, description: "Forbidden: bot was blocked by the user" });
        delivered.push(`${botId}:${chatId}`);
      },
    };
    const first = await db.notification.create({ data: { centerId: a, chatId: String(PARENT), text: "one" } });
    await processNotifications(routedSender(shared, router), { gapMs: 0 });
    expect(delivered).toEqual([`${BOT_ID}:${PARENT}`]);
    expect((await db.notification.findUnique({ where: { id: first.id } }))?.sentVia).toBe(String(BOT_ID));

    centerFails = true;
    const second = await db.notification.create({ data: { centerId: a, chatId: String(PARENT), text: "two" } });
    await processNotifications(routedSender(shared, router), { gapMs: 0 });
    expect(delivered.at(-1)).toBe(`shared:${PARENT}`);
    expect(await db.notification.findUnique({ where: { id: second.id } })).toMatchObject({ status: "SENT", sentVia: null });
    expect(await db.telegramLink.count({ where: { chatId: String(PARENT) } })).toBeGreaterThan(0);
    expect(await routeBotFor(a, String(PARENT))).toBeNull();
    await db.botChat.update({ where: { botId_chatId: { botId: String(BOT_ID), chatId: String(PARENT) } }, data: { blockedAt: null } });
  });

  it("a 403 from the shared bot does not unlink someone an ACTIVE center bot still reaches", async () => {
    expect(await reachableByCenterBot(String(PARENT))).toBe(true);
    const n = await db.notification.create({ data: { centerId: b, chatId: String(PARENT), text: "from B" } });
    const shared: Sender = async () => {
      throw Object.assign(new Error("Forbidden"), { error_code: 403, description: "Forbidden: bot can't initiate conversation with a user" });
    };
    const r = await processNotifications(routedSender(shared, defaultRouter), { gapMs: 0 });
    expect(r.unlinked).toBe(0);
    expect(await db.notification.findUnique({ where: { id: n.id } })).toMatchObject({ status: "FAILED" });
    expect(await db.telegramLink.count({ where: { chatId: String(PARENT) } })).toBeGreaterThan(0);
  });
});

describe("tell families and the Mini App", () => {
  it("queues one message per linked family chat that hasn't started the bot, once", async () => {
    await db.botChat.deleteMany({ where: { botId: String(BOT_ID), chatId: String(PARENT) } });
    const n = await tellFamilies(a, ownerId);
    expect(n).toBe(1);
    const row = await db.notification.findFirst({ where: { centerId: a, chatId: String(PARENT), dedupeKey: { startsWith: "ownbot:" } } });
    expect(row?.text).toContain("@ilm_markazi_bot");
    expect(await tellFamilies(a, ownerId)).toBe(0);
    await db.botChat.create({ data: { botId: String(BOT_ID), chatId: String(PARENT) } });
  });

  const initData = (userId: number, token: string) => {
    const p = new URLSearchParams({ query_id: "Q", user: JSON.stringify({ id: userId, first_name: "Ona", language_code: "uz" }), auth_date: String(Math.floor(Date.now() / 1000)) });
    p.set("hash", initDataHash([...p.entries()], token));
    return p.toString();
  };
  const call = (body: string, b?: string) => POST(new Request(`http://localhost/api/tg/data${b ? `?b=${b}` : ""}`, { method: "POST", body }));

  it("?b=<bot> checks the init data with that bot's token and shows that center only", async () => {
    const r = await call(initData(PARENT, BOT_TOKEN), String(BOT_ID));
    expect(r.status).toBe(200);
    const j = (await r.json()) as { data: { families: { center: string }[] } };
    expect(j.data.families.map((f) => f.center)).toEqual(["Ilm Markazi"]);
    // signed by the shared bot but sent as the center bot's Mini App → refused
    expect((await call(initData(PARENT, MANAGER), String(BOT_ID))).status).toBe(401);
    // the shared bot's Mini App still shows both
    const s = (await (await call(initData(PARENT, MANAGER))).json()) as { data: { families: unknown[] } };
    expect(s.data.families).toHaveLength(2);
  });

  it("a paused bot's Mini App is closed and its messages go through the shared bot", async () => {
    await changeBotStatus(a, ownerId, "pause");
    expect((await call(initData(PARENT, BOT_TOKEN), String(BOT_ID))).status).toBe(503);
    expect(await routeBotFor(a, String(PARENT))).toBeNull();
    await changeBotStatus(a, ownerId, "resume");
    expect(await routeBotFor(a, String(PARENT))).toBe(String(BOT_ID));
  });

  it("a disabled center's bot carries nothing", async () => {
    await db.center.update({ where: { id: a }, data: { disabledAt: new Date() } });
    expect(await routeBotFor(a, String(PARENT))).toBeNull();
    await db.center.update({ where: { id: a }, data: { disabledAt: null } });
  });
});
