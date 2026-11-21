-- First pilot: Paynet payments recorded by hand; a course billed by calendar months can start its month on any day (1–28).
ALTER TYPE "PaymentMethod" ADD VALUE 'PAYNET';
ALTER TABLE "Course" ADD COLUMN "renewalDay" INTEGER NOT NULL DEFAULT 1;
