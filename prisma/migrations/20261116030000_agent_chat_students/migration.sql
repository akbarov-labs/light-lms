-- Every student an AI agent chat booked (a parent may book two children). Backfilled from studentId.
ALTER TABLE "AgentChat" ADD COLUMN "studentIds" TEXT[] DEFAULT ARRAY[]::TEXT[];
UPDATE "AgentChat" SET "studentIds" = ARRAY["studentId"] WHERE "studentId" IS NOT NULL;
