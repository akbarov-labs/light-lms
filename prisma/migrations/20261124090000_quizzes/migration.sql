-- CreateEnum
CREATE TYPE "QuizKind" AS ENUM ('TOPIC', 'PLACEMENT');

-- CreateEnum
CREATE TYPE "QuizStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED');

-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "currentTopicId" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "button" JSONB;

-- CreateTable
CREATE TABLE "Quiz" (
    "id" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "kind" "QuizKind" NOT NULL DEFAULT 'TOPIC',
    "title" TEXT NOT NULL,
    "groupId" TEXT,
    "topicId" TEXT,
    "minutes" INTEGER NOT NULL,
    "questionIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "questionCount" INTEGER NOT NULL DEFAULT 0,
    "passPercent" INTEGER NOT NULL DEFAULT 70,
    "status" "QuizStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "parentsSentAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Quiz_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuizAttempt" (
    "id" TEXT NOT NULL,
    "quizId" TEXT NOT NULL,
    "studentId" TEXT,
    "leadId" TEXT,
    "chatId" TEXT NOT NULL,
    "name" TEXT,
    "topicId" TEXT,
    "questionIds" TEXT[],
    "answers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deadlineAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "autoSubmitted" BOOLEAN NOT NULL DEFAULT false,
    "correct" INTEGER,
    "total" INTEGER NOT NULL,
    "placedGroupId" TEXT,
    "placedEnrollmentId" TEXT,
    "placedAt" TIMESTAMP(3),
    "placedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuizAttempt_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Quiz_centerId_kind_createdAt_idx" ON "Quiz"("centerId", "kind", "createdAt");

-- CreateIndex
CREATE INDEX "Quiz_groupId_idx" ON "Quiz"("groupId");

-- CreateIndex
CREATE INDEX "QuizAttempt_quizId_createdAt_idx" ON "QuizAttempt"("quizId", "createdAt");

-- CreateIndex
CREATE INDEX "QuizAttempt_chatId_idx" ON "QuizAttempt"("chatId");

-- CreateIndex
CREATE INDEX "QuizAttempt_submittedAt_deadlineAt_idx" ON "QuizAttempt"("submittedAt", "deadlineAt");

-- CreateIndex
CREATE UNIQUE INDEX "QuizAttempt_quizId_studentId_key" ON "QuizAttempt"("quizId", "studentId");

-- AddForeignKey
ALTER TABLE "Group" ADD CONSTRAINT "Group_currentTopicId_fkey" FOREIGN KEY ("currentTopicId") REFERENCES "QuestionTopic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quiz" ADD CONSTRAINT "Quiz_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "QuestionTopic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAttempt" ADD CONSTRAINT "QuizAttempt_quizId_fkey" FOREIGN KEY ("quizId") REFERENCES "Quiz"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAttempt" ADD CONSTRAINT "QuizAttempt_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAttempt" ADD CONSTRAINT "QuizAttempt_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuizAttempt" ADD CONSTRAINT "QuizAttempt_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "QuestionTopic"("id") ON DELETE SET NULL ON UPDATE CASCADE;

