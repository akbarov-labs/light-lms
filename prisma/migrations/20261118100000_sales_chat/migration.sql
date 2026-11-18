-- CreateTable
CREATE TABLE "SalesChat" (
    "id" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "name" TEXT,
    "username" TEXT,
    "phone" TEXT,
    "awaitingPhone" BOOLEAN NOT NULL DEFAULT false,
    "messages" JSONB NOT NULL DEFAULT '[]',
    "teamMessageIds" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesChat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalesUsage" (
    "month" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "calls" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "SalesUsage_pkey" PRIMARY KEY ("month")
);

-- CreateIndex
CREATE UNIQUE INDEX "SalesChat_chatId_key" ON "SalesChat"("chatId");

