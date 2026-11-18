# A center's own Telegram bot (managed bots)

*2026-11-18. Checked against https://core.telegram.org/bots/api, https://core.telegram.org/bots/features and
the Bot API changelog (9.6, 10.0, 10.4). **Built** behind `TELEGRAM_MANAGED_BOTS=false` (phases 1 and 2
below), covered by unit and DB tests; **not yet tried with a real managed bot** — step 1 of "Rollout" is
still to do.*

## Where it lives

| Part | File |
|---|---|
| Token cache, Bot API calls (`getManagedBotToken`, access settings) | `src/lib/managed-bots/api.ts` |
| Creation codes, `managed_bot` updates, status changes, routing, "tell families" | `src/lib/managed-bots/service.ts` |
| Center scope (AsyncLocalStorage) read by `validLinks` and `activeAgentChat` | `src/lib/managed-bots/scope.ts` |
| Bot handlers (`createBot(token, { scope })`, `/start nb_<code>`, `managed_bot`) | `src/worker/bot/index.ts` |
| Polling one bot per center | `src/worker/bot/pool.ts` |
| Choosing the bot per queued row, 403 fallback, `sentVia` | `src/worker/notifications.ts` (`routedSender`) |
| Settings → Telegram bot; platform allow-list | `src/app/(admin)/settings/telegram/`, `src/app/(admin)/platform/` |
| Mini App `?b=<bot id>` | `src/app/api/tg/data/route.ts`, `src/app/tg/mini-app.tsx` |
| Tests | `src/lib/managed-bots/managed-bots.test.ts`, `src/worker/notifications.test.ts`, `tests/managed-bots.test.ts` |

**To turn it on:** set `TELEGRAM_MANAGED_BOTS=true` for web and worker; turn on "Bot Management Mode" for
the shared bot in the @BotFather Mini App (the worker logs a warning when `getMe.can_manage_bots` is false);
a platform admin allows the center on `/platform` ("O'z boti"); the center's OWNER, linked in the shared bot,
presses "Bot yaratish" in Settings → Telegram bot.

### Built differently from the design below

- **Center disabled or allow-list removed** doesn't change the bot's status: the worker stops polling it and
  routing skips it, and it comes back by itself when the center is enabled again. PAUSED is only the owner's
  choice in Settings. "Resume" goes straight to ACTIVE.
- **429 from a center bot** pauses the whole Telegram batch, as a 429 from the shared bot does; there is no
  backoff per bot yet.
- **Owner change** is recorded (audit `bot.owner`) but nobody is notified in the app yet. **A gone bot** shows
  its reason in Settings and sends an ops alert; no in-app notice to the owner.
- Set up on start: commands and the Mini App menu button. Descriptions aren't set (the owner can set them
  in BotFather).
- `npm run job:notifications` uses the same routing as the worker, so a manual run can't unlink a chat
  that only a center bot reaches.

## The problem

Every center shares one bot (`TELEGRAM_BOT_TOKEN`). Parents see our bot's name and avatar, not the center's.
The AI lead agent needs `t.me/<bot>?start=<slug>` to know which center a stranger means (DECISIONS 2026-11-16,
2026-11-16 "plain /start"). Bigger clients want a bot with their own name.

On 2026-11-16 we decided that a separate bot per center wasn't worth it yet. The reasons were: tokens are full
control of a bot, plus a webhook per bot and a Mini App per bot. Managed bots remove the manual part: the
owner never visits BotFather and never copies a token. The runtime cost (many bots in one worker) stays and is
designed below.

## What Telegram offers (verified in the docs)

| Feature | Since | Notes |
|---|---|---|
| Bot Management Mode | 9.6 | Turned on for **our** bot in the @BotFather Mini App (bot settings). `getMe` then returns `can_manage_bots: true`. |
| `KeyboardButton.request_managed_bot` (`KeyboardButtonRequestManagedBot`: `request_id`, `suggested_name`, `suggested_username`) | 9.6 | A reply-keyboard button in a private chat with our bot. Pressing it opens Telegram's "create bot" window with the name and username pre-filled and editable. Username must end in `bot` (Premium users may also use `agent`/`ai`/`app`/`game` as a secondary username, 10.4). |
| Link `https://t.me/newbot/{manager}/{suggested_username}?name={name}` | 9.6 | The same window opened from a link, outside our chat. |
| `Message.managed_bot_created` (`ManagedBotCreated`: `bot`) | 9.6 | Service message in the chat where the button was pressed. |
| `Update.managed_bot` (`ManagedBotUpdated`: `user` = creator, `bot`) | 9.6 | Sent when a managed bot is created, **or its token or owner changes**. |
| `getManagedBotToken(user_id)` / `replaceManagedBotToken(user_id)` | 9.6 | Read the token / revoke it and get a new one. `user_id` = the managed bot's id. |
| `getManagedBotAccessSettings` / `setManagedBotAccessSettings(user_id, is_access_restricted, added_user_ids ≤ 10)` | 10.0 | Limit the bot to its owner plus up to 10 users. "The bot's owner can always access it." |
| `savePreparedKeyboardButton` (`request_managed_bot` type) | 9.6 | Start the same flow from inside a Mini App. Not needed for v1. |

The person who confirms creation becomes the bot's owner in Telegram. Our bot controls it through the token.

**Not documented** (test with a real test bot first):
- Whether `getManagedBotToken` can be called repeatedly (every worker start) or is rate-limited. The design
  below depends on this; there is a fallback.
- Whether `managed_bot` is in the default `allowed_updates` set. We pass `allowed_updates` explicitly anyway.
- What the owner can do in BotFather with a managed bot: see or revoke the token, delete the bot, transfer
  it, turn our management off. And what update (if any) we get for each.
- How many bots one manager bot can manage.
- Whether grammY 1.46 has types for these methods and the `managed_bot` update. If not, call them with
  `fetch`, as `src/lib/telegram.ts` already does.

## What makes this cheaper than it looks

**A private chat's id is the person's Telegram user id, whatever the bot.** `TelegramLink`,
`Guardian.telegramChatId`, `Student.telegramChatId`, `User.telegramChatId` and `AgentChat.chatId` all store
that id. So a parent who already linked their phone in the shared bot is **already linked** when they press
/start in the center's bot. No second contact share, no data migration.

What does change: a bot can only message people who started it. So we need to know, per bot, who started it.

## Proposed design

**Switch:** env `TELEGRAM_MANAGED_BOTS` (default false), read by the worker and the web app. With it off,
nothing changes and the settings card is hidden. The shared bot keeps every job it has today: centers
without their own bot, ops alerts, creating bots, and fallback.

### Data

```prisma
/// A center's own bot, created through Telegram's managed bots (Bot API 9.6). The token is NOT stored.
model CenterBot {
  /// the bot's Telegram user id (string, like chatId)
  botId     String          @id
  centerId  String          @unique
  center    Center          @relation(fields: [centerId], references: [id])
  username  String
  name      String
  /// Telegram user id of the bot's owner (the creator; updated on owner change)
  ownerTgId String
  status    CenterBotStatus @default(TESTING)
  lastError String?
  createdAt DateTime        @default(now())
  updatedAt DateTime        @updatedAt
}

enum CenterBotStatus {
  TESTING // access limited to the owner (setManagedBotAccessSettings), families are not moved yet
  ACTIVE  // open to everyone; the center's messages go through it
  PAUSED  // center disabled, plan dropped or owner disconnected it: not polled, messages use the shared bot
  GONE    // deleted, or the token can't be fetched: not polled, messages use the shared bot
}

/// Who started which managed bot: a bot can only message people who started it.
model BotChat {
  botId     String
  chatId    String
  startedAt DateTime  @default(now())
  /// 403 from this bot (blocked): messages go through the shared bot again
  blockedAt DateTime?
  @@id([botId, chatId])
}

/// One-time code behind "Create our bot" in Settings (10 minutes, single use).
model BotCreateRequest {
  code      String    @id
  centerId  String
  userId    String    // the OWNER who pressed the button
  chatId    String?   // set when the code is opened in the shared bot
  expiresAt DateTime
  usedAt    DateTime?
  @@index([chatId])
}
```

`Notification` gets a nullable `sentVia` (bot id, null = shared bot), filled when sent: it helps support
and shows in the queue screens. All changes are additive migrations.

### The token: fetch it, don't store it

`getManagedBotToken` gives our bot the token whenever we ask. So we keep tokens **only in memory**:
- The worker fetches each ACTIVE/TESTING bot's token at start and when a `managed_bot` update says the
  token changed.
- The web app (Mini App check, reset codes) fetches on first use and caches it for 10 minutes.
- Tokens are never written to the DB, never logged, never sent to the browser.

Nothing to encrypt, no key to rotate, and a DB dump holds no bot tokens. **Fallback** if the test bot shows
that `getManagedBotToken` is limited: an encrypted `CenterBot.tokenEnc` column (AES-256-GCM, key from a new
env `BOT_TOKEN_KEY`), with `getManagedBotToken` used only to refresh it.

### Creating the bot

1. **Settings → Telegram → "Own bot"** (OWNER only; centers on the platform's allow-list during the pilot).
   The button creates a `BotCreateRequest` and opens `t.me/<shared_bot>?start=nb_<code>`.
2. **Shared bot, `/start nb_<code>`:** the code must be fresh and unused, and the chat must be linked staff
   with role OWNER **of that center** (`chatRoles` / `TelegramLink`). If so, store `chatId` on the request
   and reply with a one-button reply keyboard:
   `request_managed_bot { request_id, suggested_name: <center name>, suggested_username: <slug>_bot }`.
   We don't use the bare `t.me/newbot/...` link. It carries no payload, so we couldn't tell which center a
   new bot belongs to; the button ties the result to a chat we checked.
3. **`managed_bot` update (new bot):** find the unused request whose `chatId` = `update.user.id` (made in
   the last 10 minutes). No match → ignore it and log it (someone else's bot under our manager); we never
   attach a bot without a checked request. Match → `CenterBot` (status TESTING), mark the request used.
   `managed_bot_created` in the same chat only triggers the reply: "@x_bot is ready, open it and check it".
4. **Set up the new bot** (worker, with its token): `setManagedBotAccessSettings(restricted = true)`, owner
   only; commands (`setMyCommands`), the Mini App menu button (`/tg?b=<botId>`), description and short
   description from the center's name; start polling it.
5. **Owner checks it**, then presses **"Launch"** in Settings: access opens to everyone, status ACTIVE. The
   center's agent link, landing page and Settings now show `t.me/<own_bot>`.
6. Optional **"Tell families"** button: one message per linked family of this center, sent through the
   shared bot ("We now have our own bot: @x_bot", URL button). It goes through the normal queue with a
   dedupe key per family.

### Running many bots (worker)

- A `BotPool` in the worker holds one grammY `Bot` per ACTIVE/TESTING `CenterBot`, all built by the existing
  `createBot(token, scope)`. Each runs long polling (`drop_pending_updates`, explicit `allowed_updates`).
  Every minute it reconciles with the table: start new bots, stop PAUSED/GONE ones.
- Polling holds one open HTTP request per bot. That's fine for tens of bots in one process. **Planned limit:
  100 bots per worker.** Past roughly 50 bots, move to webhooks: one route `/api/tg/hook/[botId]` that checks
  `X-Telegram-Bot-Api-Secret-Token` and writes the update to a table the worker drains, so the bot code stays
  in the worker. Not built now.
- `401 Unauthorized` from a bot → fetch the token again once; still failing → GONE with `lastError`, alert
  the owner (in-app) and ops.
- The in-memory attendance drafts and the agent's per-chat queue are keyed by chat (+ lesson). They work
  unchanged across bots: one person is one chat id in every bot.

### What a center's bot shows: that center only

`createBot(token, scope)` gets `scope = { centerId } | null` (null = the shared bot, as today).
`chatRoles`, `chatStudents`, `validLinks` and the menu texts take an optional `centerId` filter. **A
center's bot never shows another center's data**, even when the parent has children at two centers. That
bot's name, avatar and description belong to a client, so another center's balances must never pass through
it. The shared bot keeps showing everything.

| Handler | In a center's bot |
|---|---|
| `/start` (no payload) | Linked family/staff of this center → their menu. Anyone else → **this center's AI agent straight away** (when it is on), no `?start=<slug>` needed. Agent off → the welcome with the contact button. |
| `/start <anything>` | Treated as plain `/start`. Only the shared bot reads center slugs and `nb_` codes. |
| Contact share | `linkChat` as today (links are global). The reply and menu use this center's links. A number only known at another center gets "not found here", not that center's menu. |
| Staff reply to "🤖❓" | As today (`replied.from.id === ctx.me.id` already checks the right bot), and the lead must belong to this center. |
| `/parol` | Only staff of this center. |
| Every update in a private chat | Upsert `BotChat(botId, chatId)` and clear `blockedAt`. |

### Sending (notification queue)

For each Telegram row, choose the bot when sending:
1. The row's center has an ACTIVE `CenterBot` **and** `BotChat(botId, chatId)` exists without `blockedAt`
   → send through the center's bot.
2. Otherwise → the shared bot, as today.

Errors:
- **403 from a center's bot** → set `BotChat.blockedAt` and send again through the shared bot in the same
  attempt. **Don't unlink the chat**: the person blocked one bot, not us. Today a 403 unlinks the chat
  (DECISIONS 2026-10-17); that rule stays for the shared bot.
- 403 from the shared bot → unlink, as today.
- A row for a person who never started either bot fails the same way it does today.
- 429: each bot has its own flood limit. Back off per bot (today the queue backs off as one).

`sendTelegram` (web app reset codes) uses the same choice. A staff member who only ever started the center's
bot still gets the code.

### Mini App

- A center's bot opens `/tg?b=<botId>`. `/api/tg/data` reads `b`, fetches that bot's token (cached) and
  checks the init data with it (`verifyInitData(raw, token)`, unchanged). No `b` → the shared bot's token, as
  today. An unknown or GONE `b` → 401.
- With `b`, the data is scoped to that center, like the bot.

### Managed-bot updates after creation

| Update | What we do |
|---|---|
| Token changed (the owner revoked it in BotFather, or we called `replaceManagedBotToken`) | Drop the cached token, fetch it again, restart that bot. |
| Owner changed (transferred to a new director) | Update `ownerTgId`; keep running; in-app notice to the center's OWNER users. |
| Bot gone / token can't be fetched | GONE, stop polling, messages fall back to the shared bot, notice to the owner and ops. |

### When a center leaves or is disabled

PAUSED: we stop polling and the bot stays the client's. We don't call `replaceManagedBotToken` to lock them
out. Whether they can take the bot to another provider depends on what BotFather lets the owner do with a
managed bot (see "Not documented").

## Security

- Only a center's OWNER, linked in the shared bot, with a 10-minute single-use code, can attach a bot to that
  center. The `managed_bot` update must come from that same Telegram user.
- Tokens live only in process memory (or encrypted, if we fall back), never in logs, the browser or audit
  rows.
- The client controls the bot's name, avatar and description. That's why its data scope is one center and
  its `/start` ignores slugs: it can't be used to pose as another center or read its data.
- The audit log records: bot created, launched, paused, gone, owner changed.

## Tests

- Unit: choosing the sending bot (ACTIVE + started → center's bot; blocked, PAUSED, GONE, not started →
  shared bot); `BotCreateRequest` checks (expired, used, wrong center, not OWNER, different creator).
- Bot handlers with the recording transformer (as in `tests/bot-handlers.test.ts`), for a center's bot:
  `/start` from a stranger → agent without slug; linked parent with children at two centers → sees only this
  center; staff reply to "🤖❓" for another center's lead → refused; `BotChat` upserted.
- Queue: 403 from the center's bot → `blockedAt` set, re-sent through the shared bot, the chat stays linked.
- Mini App: init data signed with the center bot's token passes with `b`, fails without it.

## Rollout

1. **Test bot:** turn on Bot Management Mode on a *test* manager bot; create a managed bot; answer every
   "Not documented" question above; note the exact errors. Decide the token fallback here.
2. Build behind `TELEGRAM_MANAGED_BOTS=false`. Phase 1: data, creation flow, `BotPool`, scoped menus,
   sending, Settings card. Phase 2: Mini App `?b=`, agent without slug, "Tell families", owner-change
   notices.
3. Pilot with one center (platform allow-list), then turn on Bot Management Mode on the production bot.
4. Pricing: a paid add-on, like the AI agent. It sits outside the code; the allow-list gates it until a plan
   field exists.

## Risks

- **Many open connections:** polling one bot per center doesn't scale past ~100 per worker. The webhook path
  above is the way out; design it before we reach ~50 bots.
- **Two bots in a parent's list:** families linked through the shared bot may get some messages there until
  they start the center's bot. "Tell families" and the fallback keep messages flowing; nobody misses a
  message, it may just arrive in the other chat.
- **Owner leaves with the bot:** the client owns it in Telegram and can delete it. We fall back to the shared
  bot, so no message is lost, but the center's links (`t.me/<own_bot>`) break. Settings must show this
  clearly.
- **Undocumented limits** (`getManagedBotToken` calls, bots per manager): the test-bot step comes first for
  this reason.
