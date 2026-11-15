-- CreateEnum
CREATE TYPE "ActorKind" AS ENUM ('USER', 'PUBLIC', 'AGENT', 'SYSTEM');

-- (Prisma also proposed dropping the raw-SQL trigram / partial indexes that schema.prisma cannot
-- express; those drops are removed on purpose — the indexes stay.)

-- AlterTable
ALTER TABLE "AuditLog" ADD COLUMN     "actor" "ActorKind" NOT NULL DEFAULT 'SYSTEM';

-- AlterTable
ALTER TABLE "LeadNote" ADD COLUMN     "actor" "ActorKind" NOT NULL DEFAULT 'USER';

-- Backfill: rows written before this column existed. A staff user is USER; the public lead form
-- wrote "*.public" actions with no user; every other row without a user came from a background job.
UPDATE "AuditLog" SET "actor" = 'USER' WHERE "userId" IS NOT NULL;
UPDATE "AuditLog" SET "actor" = 'PUBLIC' WHERE "userId" IS NULL AND "action" LIKE '%.public';
-- Lead notes without an author were written by the public lead form (repeat submissions, comments).
UPDATE "LeadNote" SET "actor" = 'PUBLIC' WHERE "createdById" IS NULL;

-- CreateTable
CREATE TABLE "AgentChat" (
    "id" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "chatId" TEXT NOT NULL,
    "leadId" TEXT,
    "studentId" TEXT,
    "trialGroupId" TEXT,
    "phone" TEXT,
    "phoneSource" TEXT,
    "awaitingPhone" BOOLEAN NOT NULL DEFAULT false,
    "messages" JSONB NOT NULL DEFAULT '[]',
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "lastMessageAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentChat_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentUsage" (
    "centerId" TEXT NOT NULL,
    "month" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "calls" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "AgentUsage_pkey" PRIMARY KEY ("centerId","month")
);

-- CreateIndex
CREATE INDEX "AgentChat_chatId_lastMessageAt_idx" ON "AgentChat"("chatId", "lastMessageAt");

-- CreateIndex
CREATE INDEX "AgentChat_leadId_idx" ON "AgentChat"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "AgentChat_centerId_chatId_key" ON "AgentChat"("centerId", "chatId");

-- AddForeignKey
ALTER TABLE "AgentChat" ADD CONSTRAINT "AgentChat_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentChat" ADD CONSTRAINT "AgentChat_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentUsage" ADD CONSTRAINT "AgentUsage_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
