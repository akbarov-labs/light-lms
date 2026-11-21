-- Every message of a center's AI chats (lead agent, tutor) for the owner and the platform team; kept 90 days.
CREATE TYPE "BotChatKind" AS ENUM ('AGENT', 'TUTOR');
CREATE TYPE "BotMessageFrom" AS ENUM ('PERSON', 'BOT', 'STAFF');

CREATE TABLE "BotMessage" (
    "id" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "kind" "BotChatKind" NOT NULL,
    "from" "BotMessageFrom" NOT NULL,
    "name" TEXT,
    "text" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BotMessage_centerId_createdAt_idx" ON "BotMessage"("centerId", "createdAt");
CREATE INDEX "BotMessage_centerId_chatId_kind_createdAt_idx" ON "BotMessage"("centerId", "chatId", "kind", "createdAt");
CREATE INDEX "BotMessage_createdAt_idx" ON "BotMessage"("createdAt");

ALTER TABLE "BotMessage" ADD CONSTRAINT "BotMessage_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
