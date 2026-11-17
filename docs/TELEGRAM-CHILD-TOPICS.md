# One private-chat topic per child: design note (not built)

*2026-11-17. Checked against https://core.telegram.org/bots/api and the Bot API changelog (9.3, 9.4, 10.4). Design only: no code yet.*

## The problem

A parent with two or three children at a center gets every child's messages (absences, reminders, report
cards, exam results) in one chat with the bot. The menu replies (balance, schedule, attendance) list all
children together. Busy chats are hard to follow.

## What Telegram offers (verified in the docs)

| Feature | Since | Notes |
|---|---|---|
| Forum topic mode in private chats with the bot | 9.3 | Bot-wide setting. `getMe` returns `has_topics_enabled`. The Bot API doesn't turn it on; it is a bot setting (BotFather). |
| `message_thread_id` in private chats on `sendMessage`, `sendPhoto`, … `copyMessage`, `sendChatAction` | 9.3 | Send into a given topic. `sendRichMessage` takes it too ("private chats of bots with forum topic mode enabled"). |
| `Message.message_thread_id`, `is_topic_message` in private chats | 9.3 | Tells us which topic the parent wrote in. |
| `editForumTopic`, `deleteForumTopic`, `unpinAllForumTopicMessages` in private chats | 9.3 | Rename or remove a child's topic. |
| `createForumTopic` in a private chat with a user | 9.4 | The bot creates the topics. Name 1–128 chars. `icon_color` must be one of 6 fixed values. |
| Stop users from creating/deleting topics (BotFather Mini App setting); `getMe.allows_users_to_create_topics` | 9.4 | We want this **off**, so parents can't delete a child's topic by accident. |
| Topic links `https://t.me/<bot_username>/<message_thread_id>` | 10.4 | Opens that topic, only for that user. Useful in the web/Mini App ("open Ali's chat"). |

**Not documented** (test with a real test bot first):
- Where a message sent **without** `message_thread_id` lands once topic mode is on (General topic? the main view?).
- How the reply keyboard menu and the Mini App menu button behave inside topics.
- How older Telegram apps show a private chat with topics.
- Whether grammY's `ctx.reply` copies the topic's `message_thread_id` by itself in private chats (in groups it does for topic messages). If not, every reply must pass it.

## Proposed design

**Scope:** only chats linked to **two or more active children** (from `chatStudents`). Single-child families,
teachers and owners stay as they are: no topics, no change.

**Switch:** env `TELEGRAM_CHILD_TOPICS` (default false), checked by the worker, like `TELEGRAM_RICH_MESSAGES`.
Because topic mode is bot-wide in BotFather, it has to be turned on there **and** with the flag. With the flag
off, nothing changes even if BotFather has topics on.

### Data

```prisma
/// A child's topic in a parent's private chat with the bot (Bot API 9.3/9.4)
model ChatTopic {
  chatId    String
  studentId String
  threadId  Int
  createdAt DateTime @default(now())
  @@id([chatId, studentId])
  @@index([chatId, threadId])
}
```

`Notification` gets a nullable `studentId` (additive migration). `notifyFamily` already gets `studentId` for
child messages; it is stored on the Telegram row. Family-level messages (debt, family payment) keep
`studentId = null`.

### Sending (worker)

1. Row has no `studentId`, or the flag is off, or the chat has < 2 children → send as today (no thread).
2. Otherwise look up `ChatTopic(chatId, studentId)`. If it is missing, call
   `createForumTopic(chatId, "<First name> <Last name>", icon_color)` (a fixed color per child order) and
   save `message_thread_id`.
3. Send with `message_thread_id` (plain or rich, same fallbacks as now).
4. **Fallbacks, so no message is lost:**
   - `createForumTopic` refused (topic mode off in BotFather, older server) → send without a thread, and
     don't try creating topics again for that chat for 24 h (an in-memory or DB mark).
   - Send refused because the thread is gone (400 like "message thread not found"; check the exact text with a
     real bot) → delete the `ChatTopic` row, create it once more, and send; if that fails too → send without a
     thread.
   - 429 / 403 / network errors keep the queue's normal handling.
5. `createForumTopic` counts against the same 25 msg/s budget: one call per new (chat, child) pair, so only a
   few calls on the first day.

### Bot menu

- Message in a child's topic (`is_topic_message` + `message_thread_id` found in `ChatTopic`) → the menu
  buttons (balance, schedule, attendance, payments) answer **for that child only**, and the reply goes into the
  same topic.
- Message in General / no thread → as today, all children.
- `/start` after linking, for a family with 2+ children: create the topics right away and post one short
  greeting in each, so the parent sees the structure at once.
- Unlinking (`unlinkChat`, phone change, archived student): delete the `ChatTopic` rows. Optionally
  `deleteForumTopic` for archived children, but keeping history is kinder. Default: keep the topic, stop
  writing to it.

### What doesn't change

Payments, debts and balances, SMS/Eskiz (SMS has no topics; `studentId` is ignored for SMS rows), the web app,
the Mini App (it may later show "open in Telegram" topic links, Bot API 10.4).

## Rollout

1. Test bot: turn on topic mode in BotFather and turn off users' topic creation/deletion. Answer the
   "not documented" questions above. Note the exact error texts.
2. Build behind `TELEGRAM_CHILD_TOPICS=false`; unit tests for routing (which messages go to which topic),
   integration tests with the recording transformer (create → send with thread; thread gone → recreate;
   create refused → no thread).
3. Turn it on for the demo/pilot install first; check teachers and owners still see their normal chat.

## Risks

- **Bot-wide mode:** BotFather topic mode affects *every* private chat of the bot, including teachers,
  owners and one-child families. We can keep their messages thread-less, but how Telegram shows a
  topic-enabled chat with no topics must be checked before turning it on in production.
- Parents may find topics confusing at first. The `/start` greeting per topic and the child's name as the
  topic title should help.
- Old app versions: if they don't show private topics well, the plain chat is still there. Confirm with
  the test bot.
