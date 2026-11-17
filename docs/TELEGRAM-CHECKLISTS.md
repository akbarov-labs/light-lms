# Telegram checklists for homework — evaluated, not built

*2026-11-17. Checked against https://core.telegram.org/bots/api and the Bot API changelog (Bot API 9.1–9.2; grammY 1.46 has the types).*

## Short answer

A plain bot like ours **can't send checklists**. `sendChecklist` and `editMessageChecklist` only work
"on behalf of a connected business account": `business_connection_id` is a **required** parameter for both.
Nothing was built.

## What the docs say

| Method / object | Since | What matters for us |
|---|---|---|
| `sendChecklist(business_connection_id, chat_id, checklist, …)` | 9.1 | `business_connection_id` is required: the message is sent from a Telegram Business user's account, not by the bot. |
| `editMessageChecklist(business_connection_id, chat_id, message_id, checklist, …)` | 9.1 | Same: business connection required. |
| `InputChecklist` | 9.1 | title 1–255 chars (bold/italic/…/`date_time` entities allowed), 1–30 tasks, `others_can_add_tasks`, `others_can_mark_tasks_as_done`. |
| `ChecklistTasksDone` / `ChecklistTasksAdded` service messages | 9.1 | How a bot learns that tasks were ticked or added. |
| `ChecklistTask.completed_by_chat`, `ReplyParameters.checklist_task_id` | 9.2 / 9.3 | Reply to one task; who ticked it. |

## What it would take

1. **A Telegram Business account per center** (one teacher's or the center's own account) connected to our bot
   in Telegram's Business settings. The bot then gets `business_connection` updates and a
   `business_connection_id`, and can send checklists **from that person's account**, only to chats that person
   has (`BusinessConnection.can_reply`, rights checked by Telegram).
2. Store the connection per center (new table), handle `business_connection` updates, and send homework as a
   checklist from the teacher's account to each parent/student chat.
3. Read `checklist_tasks_done` service messages (business messages) to know what was done.

That is a different product: messages come from a person, not from the center's bot, it needs every center
to set up Telegram Business, and the parent chats are the teacher's private chats, which our links
(`TelegramLink`) don't know about.

## Also: there is no homework in the product

HANDOFF §5 deliberately leaves homework out of year one ("centers use Telegram groups"). There is no
homework model to turn into checklists. So this item would first need a homework feature.

## If we want something like it later, without Business

What a plain bot can already do:

- **Rich message with a task list** (Bot API 10.1, already used for report cards behind
  `TELEGRAM_RICH_MESSAGES`): `<ul><li><input type="checkbox">Task</li></ul>`. It shows checkboxes, but the
  parent **can't tick them**: it is read-only formatting.
- **Inline keyboard toggles** (as in the teacher attendance roster): one button per task, ✓ when tapped, saved
  on our side. Works in every Telegram version and is fully under our control.

**Recommendation:** if homework is ever built, use a rich-message list to show it and inline buttons to tick
tasks. Don't use Business checklists.
