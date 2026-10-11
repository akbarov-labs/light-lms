
-- AlterTable
ALTER TABLE "Enrollment" ADD COLUMN     "termsHistory" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "Group" ADD COLUMN     "priceHistory" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "PaymeTransaction" ADD COLUMN     "paymeTime" BIGINT;

