
-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "branchId" TEXT;

-- CreateIndex
CREATE INDEX "Student_branchId_idx" ON "Student"("branchId");

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "Branch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

