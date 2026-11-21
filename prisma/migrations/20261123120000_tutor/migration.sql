-- Math tutor (settings.tutor): a linked student's or parent's chat with the AI tutor, last turns only.
CREATE TABLE "TutorChat" (
    "id" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "messages" JSONB NOT NULL DEFAULT '[]',
    "day" TEXT NOT NULL DEFAULT '',
    "dayMessages" INTEGER NOT NULL DEFAULT 0,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheReadTokens" INTEGER NOT NULL DEFAULT 0,
    "cacheWriteTokens" INTEGER NOT NULL DEFAULT 0,
    "blockedReplies" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TutorChat_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TutorChat_centerId_chatId_key" ON "TutorChat"("centerId", "chatId");

-- AddForeignKey
ALTER TABLE "TutorChat" ADD CONSTRAINT "TutorChat_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
