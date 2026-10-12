-- SaaS onboarding: plans, center disable switch, setup wizard progress (signup limits use LoginAttempt).

-- CreateEnum
CREATE TYPE "Plan" AS ENUM ('FREE', 'START', 'GROWTH', 'PRO');

-- AlterTable
ALTER TABLE "Center" ADD COLUMN     "disabledAt" TIMESTAMP(3),
ADD COLUMN     "disabledReason" TEXT,
ADD COLUMN     "onboarding" JSONB NOT NULL DEFAULT '{}',
ADD COLUMN     "plan" "Plan" NOT NULL DEFAULT 'FREE';

-- Centers that existed before plans are grandfathered on PRO and skip the setup wizard.
UPDATE "Center" SET "plan" = 'PRO', "onboarding" = jsonb_build_object('completedAt', to_char(now() AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
