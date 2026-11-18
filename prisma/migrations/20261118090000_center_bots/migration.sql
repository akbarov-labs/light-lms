-- A center's own Telegram bot (managed bots, Bot API 9.6): the bot, who started it, one-time creation
-- codes, the platform allow-list flag and which bot delivered a queued message. All additive.

-- CreateEnum
CREATE TYPE "CenterBotStatus" AS ENUM ('TESTING', 'ACTIVE', 'PAUSED', 'GONE');

-- AlterTable
ALTER TABLE "Center" ADD COLUMN     "ownBotAllowed" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "sentVia" TEXT;

-- CreateTable
CREATE TABLE "CenterBot" (
    "botId" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "username" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "ownerTgId" TEXT NOT NULL,
    "status" "CenterBotStatus" NOT NULL DEFAULT 'TESTING',
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CenterBot_pkey" PRIMARY KEY ("botId")
);

-- CreateTable
CREATE TABLE "BotChat" (
    "botId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "blockedAt" TIMESTAMP(3),

    CONSTRAINT "BotChat_pkey" PRIMARY KEY ("botId","chatId")
);

-- CreateTable
CREATE TABLE "BotCreateRequest" (
    "code" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "chatId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotCreateRequest_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE UNIQUE INDEX "CenterBot_centerId_key" ON "CenterBot"("centerId");

-- CreateIndex
CREATE INDEX "BotChat_chatId_idx" ON "BotChat"("chatId");

-- CreateIndex
CREATE INDEX "BotCreateRequest_chatId_idx" ON "BotCreateRequest"("chatId");

-- AddForeignKey
ALTER TABLE "CenterBot" ADD CONSTRAINT "CenterBot_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BotChat" ADD CONSTRAINT "BotChat_botId_fkey" FOREIGN KEY ("botId") REFERENCES "CenterBot"("botId") ON DELETE CASCADE ON UPDATE CASCADE;

