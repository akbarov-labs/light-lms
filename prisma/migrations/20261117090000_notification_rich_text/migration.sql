-- Bot API 10.1 rich messages: an optional rich-HTML form of a queued Telegram message. Only read when
-- TELEGRAM_RICH_MESSAGES=true; `text` stays the message (and the fallback when a rich send is refused).

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "richText" TEXT;
