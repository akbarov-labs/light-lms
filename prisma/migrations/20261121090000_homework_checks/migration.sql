-- Homework for the first pilot center: students check their answers (a few tries), late answers, photos.
ALTER TABLE "HomeworkSubmission"
  ADD COLUMN "checks" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "firstAnswers" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "checkedAnswers" TEXT[] DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "firstAnsweredAt" TIMESTAMP(3),
  ADD COLUMN "checkedAt" TIMESTAMP(3);

-- answers saved before this change count from when the row was last written
UPDATE "HomeworkSubmission" SET "firstAnsweredAt" = "updatedAt" WHERE EXISTS (SELECT 1 FROM unnest("answers") a WHERE a <> '');
