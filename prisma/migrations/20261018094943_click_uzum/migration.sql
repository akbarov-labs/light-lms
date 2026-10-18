-- v2: Click SHOP-API and Uzum Bank Merchant API — provider credentials per center, one transaction table each.

-- CreateEnum
CREATE TYPE "UzumState" AS ENUM ('CREATED', 'CONFIRMED', 'REVERSED', 'FAILED');

-- AlterTable
ALTER TABLE "Center" ADD COLUMN     "clickMerchantId" TEXT,
ADD COLUMN     "clickSecretKey" TEXT,
ADD COLUMN     "clickServiceId" TEXT,
ADD COLUMN     "uzumLogin" TEXT,
ADD COLUMN     "uzumPassword" TEXT,
ADD COLUMN     "uzumServiceId" TEXT;

-- CreateTable
CREATE TABLE "ClickTransaction" (
    "id" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "clickTransId" TEXT NOT NULL,
    "clickPaydocId" TEXT,
    "familyId" TEXT NOT NULL,
    "amount" INTEGER NOT NULL,
    "prepareId" SERIAL NOT NULL,
    "state" INTEGER NOT NULL DEFAULT 0,
    "error" INTEGER,
    "ledgerEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "ClickTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UzumTransaction" (
    "id" TEXT NOT NULL,
    "centerId" TEXT NOT NULL,
    "transId" TEXT NOT NULL,
    "familyId" TEXT NOT NULL,
    "amountTiyin" BIGINT NOT NULL,
    "state" "UzumState" NOT NULL DEFAULT 'CREATED',
    "createTime" BIGINT NOT NULL,
    "confirmTime" BIGINT,
    "reverseTime" BIGINT,
    "paymentSource" TEXT,
    "ledgerEntryId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UzumTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ClickTransaction_clickTransId_key" ON "ClickTransaction"("clickTransId");

-- CreateIndex
CREATE UNIQUE INDEX "ClickTransaction_prepareId_key" ON "ClickTransaction"("prepareId");

-- CreateIndex
CREATE UNIQUE INDEX "ClickTransaction_ledgerEntryId_key" ON "ClickTransaction"("ledgerEntryId");

-- CreateIndex
CREATE INDEX "ClickTransaction_familyId_idx" ON "ClickTransaction"("familyId");

-- CreateIndex
CREATE INDEX "ClickTransaction_centerId_createdAt_idx" ON "ClickTransaction"("centerId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UzumTransaction_transId_key" ON "UzumTransaction"("transId");

-- CreateIndex
CREATE UNIQUE INDEX "UzumTransaction_ledgerEntryId_key" ON "UzumTransaction"("ledgerEntryId");

-- CreateIndex
CREATE INDEX "UzumTransaction_familyId_idx" ON "UzumTransaction"("familyId");

-- CreateIndex
CREATE INDEX "UzumTransaction_centerId_createTime_idx" ON "UzumTransaction"("centerId", "createTime");

-- CreateIndex
CREATE UNIQUE INDEX "Center_clickServiceId_key" ON "Center"("clickServiceId");

-- CreateIndex
CREATE UNIQUE INDEX "Center_uzumServiceId_key" ON "Center"("uzumServiceId");

-- AddForeignKey
ALTER TABLE "ClickTransaction" ADD CONSTRAINT "ClickTransaction_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClickTransaction" ADD CONSTRAINT "ClickTransaction_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClickTransaction" ADD CONSTRAINT "ClickTransaction_ledgerEntryId_fkey" FOREIGN KEY ("ledgerEntryId") REFERENCES "LedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UzumTransaction" ADD CONSTRAINT "UzumTransaction_centerId_fkey" FOREIGN KEY ("centerId") REFERENCES "Center"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UzumTransaction" ADD CONSTRAINT "UzumTransaction_familyId_fkey" FOREIGN KEY ("familyId") REFERENCES "Family"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UzumTransaction" ADD CONSTRAINT "UzumTransaction_ledgerEntryId_fkey" FOREIGN KEY ("ledgerEntryId") REFERENCES "LedgerEntry"("id") ON DELETE SET NULL ON UPDATE CASCADE;

