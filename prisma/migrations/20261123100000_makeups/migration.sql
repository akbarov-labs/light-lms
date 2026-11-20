-- Make-up lessons (first pilot: missed lessons are made up on Sundays only).
CREATE TYPE "MakeupStatus" AS ENUM ('PLANNED', 'DONE', 'MISSED');

CREATE TABLE "Makeup" (
    "id" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "lessonId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "time" TEXT NOT NULL,
    "status" "MakeupStatus" NOT NULL DEFAULT 'PLANNED',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Makeup_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Makeup_centerId_date_idx" ON "Makeup"("centerId", "date");
CREATE UNIQUE INDEX "Makeup_studentId_lessonId_key" ON "Makeup"("studentId", "lessonId");

ALTER TABLE "Makeup" ADD CONSTRAINT "Makeup_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Makeup" ADD CONSTRAINT "Makeup_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Makeup" ADD CONSTRAINT "Makeup_lessonId_fkey" FOREIGN KEY ("lessonId") REFERENCES "Lesson"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
