-- v2: SMS through each center's own Eskiz.uz account; SMS rows share the Notification queue (channel).

-- CreateEnum
CREATE TYPE "NotificationChannel" AS ENUM ('TELEGRAM', 'SMS');

-- AlterTable
ALTER TABLE "Center" ADD COLUMN     "smsFrom" TEXT,
ADD COLUMN     "smsLogin" TEXT,
ADD COLUMN     "smsPassword" TEXT;

-- AlterTable
ALTER TABLE "Notification" ADD COLUMN     "channel" "NotificationChannel" NOT NULL DEFAULT 'TELEGRAM';

-- CreateIndex
CREATE INDEX "Notification_channel_status_nextAttemptAt_idx" ON "Notification"("channel", "status", "nextAttemptAt");

