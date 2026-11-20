-- CreateEnum
CREATE TYPE "QuestionSource" AS ENUM ('BOOK', 'AGENT', 'TEACHER');

-- CreateEnum
CREATE TYPE "QuestionStatus" AS ENUM ('DRAFT', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "KeyCheck" AS ENUM ('STATED', 'AGREED', 'CONFLICT', 'UNKNOWN');

-- CreateTable
CREATE TABLE "QuestionTopic" (
    "id" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "QuestionTopic_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Question" (
    "id" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "topicId" TEXT NOT NULL,
    "number" INTEGER,
    "text" TEXT NOT NULL,
    "options" TEXT[],
    "answer" TEXT NOT NULL,
    "keyCheck" "KeyCheck" NOT NULL,
    "statedAnswer" TEXT,
    "solves" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "solution" TEXT,
    "needsFigure" BOOLEAN NOT NULL DEFAULT false,
    "source" "QuestionSource" NOT NULL,
    "sourceRef" TEXT,
    "page" INTEGER,
    "status" "QuestionStatus" NOT NULL DEFAULT 'DRAFT',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Question_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "QuestionTopic_centerId_code_key" ON "QuestionTopic"("centerId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Question_topicId_number_key" ON "Question"("topicId", "number");

-- CreateIndex
CREATE INDEX "Question_centerId_status_idx" ON "Question"("centerId", "status");

-- AddForeignKey
ALTER TABLE "QuestionTopic" ADD CONSTRAINT "QuestionTopic_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Question" ADD CONSTRAINT "Question_topicId_fkey" FOREIGN KEY ("topicId") REFERENCES "QuestionTopic"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
