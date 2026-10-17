-- Audit fixes (docs/AUDIT-2026-10-17.md): notification claim/backoff, platform admin flag,
-- unique Payme key, and indexes for the hot queries.

-- Notification queue: claim (SENDING + lockedAt) and backoff (nextAttemptAt)
ALTER TYPE "NotificationStatus" ADD VALUE 'SENDING';
ALTER TABLE "Notification" ADD COLUMN "lockedAt" TIMESTAMP(3),
ADD COLUMN "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "Notification_status_nextAttemptAt_idx" ON "Notification"("status", "nextAttemptAt");

-- Platform admin is a flag granted by an operator, not a phone number
ALTER TABLE "User" ADD COLUMN "platformAdmin" BOOLEAN NOT NULL DEFAULT false;

-- Payme key identifies the center: empty → NULL, a shared key stays only on the oldest center
UPDATE "Center" SET "paymeKey" = NULL WHERE btrim(coalesce("paymeKey", '')) = '';
UPDATE "Center" c SET "paymeKey" = NULL
WHERE c."paymeKey" IS NOT NULL
  AND EXISTS (SELECT 1 FROM "Center" o WHERE o."paymeKey" = c."paymeKey" AND (o."createdAt", o."id") < (c."createdAt", c."id"));
CREATE UNIQUE INDEX "Center_paymeKey_key" ON "Center"("paymeKey");

-- Indexes
CREATE INDEX "Enrollment_endDate_idx" ON "Enrollment"("endDate");
CREATE INDEX "LedgerEntry_lessonId_idx" ON "LedgerEntry"("lessonId");
-- family balances per center without touching the heap (debtors, aging, reminders)
CREATE INDEX "LedgerEntry_center_family_amount_idx" ON "LedgerEntry"("centerId", "familyId") INCLUDE ("amount");
-- audit journal hides the high-volume billing.sync rows
CREATE INDEX "AuditLog_center_created_visible_idx" ON "AuditLog"("centerId", "createdAt") WHERE "action" <> 'billing.sync';

-- Trigram search per column (the search query ILIKEs each column, so the old expression index was never used)
DROP INDEX IF EXISTS "Student_name_trgm_idx";
CREATE INDEX "Student_firstName_trgm_idx" ON "Student" USING gin ("firstName" gin_trgm_ops);
CREATE INDEX "Student_lastName_trgm_idx" ON "Student" USING gin ("lastName" gin_trgm_ops);
CREATE INDEX "Student_phone_trgm_idx" ON "Student" USING gin ("phone" gin_trgm_ops);
CREATE INDEX "Guardian_phone_trgm_idx" ON "Guardian" USING gin ("phone" gin_trgm_ops);
CREATE INDEX "Lead_phone_trgm_idx" ON "Lead" USING gin ("phone" gin_trgm_ops);
