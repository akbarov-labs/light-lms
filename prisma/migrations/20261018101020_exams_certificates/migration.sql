-- v2: exams (placement, level, final, mock), results, certificates with a public verification code.

-- CreateEnum
CREATE TYPE "ExamKind" AS ENUM ('PLACEMENT', 'LEVEL', 'FINAL', 'MOCK');

-- AlterTable
ALTER TABLE "Center" ADD COLUMN     "certSeq" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "Exam" (
    "id" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "branchId" TEXT,
    "groupId" TEXT,
    "courseId" TEXT,
    "kind" "ExamKind" NOT NULL,
    "title" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "maxScore" INTEGER NOT NULL DEFAULT 100,
    "passScore" INTEGER,
    "sections" JSONB NOT NULL DEFAULT '[]',
    "levelBands" JSONB NOT NULL DEFAULT '[]',
    "publishedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "Exam_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExamResult" (
    "id" TEXT NOT NULL,
    "examId" TEXT NOT NULL,
    "studentId" TEXT,
    "leadId" TEXT,
    "score" INTEGER NOT NULL,
    "sectionScores" JSONB NOT NULL DEFAULT '[]',
    "passed" BOOLEAN,
    "level" TEXT,
    "comment" TEXT,
    "enteredById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ExamResult_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Certificate" (
    "id" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "examId" TEXT,
    "examResultId" TEXT,
    "groupId" TEXT,
    "courseId" TEXT,
    "title" TEXT NOT NULL,
    "level" TEXT,
    "score" INTEGER,
    "maxScore" INTEGER,
    "issuedAt" DATE NOT NULL,
    "issuedById" TEXT,
    "code" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedById" TEXT,
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Certificate_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Exam_centerId_date_idx" ON "Exam"("centerId", "date");

-- CreateIndex
CREATE INDEX "Exam_groupId_idx" ON "Exam"("groupId");

-- CreateIndex
CREATE INDEX "ExamResult_studentId_idx" ON "ExamResult"("studentId");

-- CreateIndex
CREATE INDEX "ExamResult_leadId_idx" ON "ExamResult"("leadId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamResult_examId_studentId_key" ON "ExamResult"("examId", "studentId");

-- CreateIndex
CREATE UNIQUE INDEX "ExamResult_examId_leadId_key" ON "ExamResult"("examId", "leadId");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_examResultId_key" ON "Certificate"("examResultId");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_code_key" ON "Certificate"("code");

-- CreateIndex
CREATE INDEX "Certificate_studentId_idx" ON "Certificate"("studentId");

-- CreateIndex
CREATE INDEX "Certificate_centerId_issuedAt_idx" ON "Certificate"("centerId", "issuedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Certificate_centerId_number_key" ON "Certificate"("centerId", "number");

-- AddForeignKey
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "Group"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Exam" ADD CONSTRAINT "Exam_courseId_fkey" FOREIGN KEY ("courseId") REFERENCES "Course"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamResult" ADD CONSTRAINT "ExamResult_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamResult" ADD CONSTRAINT "ExamResult_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExamResult" ADD CONSTRAINT "ExamResult_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_examId_fkey" FOREIGN KEY ("examId") REFERENCES "Exam"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Certificate" ADD CONSTRAINT "Certificate_examResultId_fkey" FOREIGN KEY ("examResultId") REFERENCES "ExamResult"("id") ON DELETE SET NULL ON UPDATE CASCADE;

