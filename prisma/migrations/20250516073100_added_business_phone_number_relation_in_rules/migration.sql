/*
  Warnings:

  - Added the required column `businessPhoneNumberId` to the `Rule` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Rule" ADD COLUMN     "businessPhoneNumberId" INTEGER NOT NULL;

-- CreateIndex
CREATE INDEX "Rule_businessPhoneNumberId_idx" ON "Rule"("businessPhoneNumberId");

-- AddForeignKey
ALTER TABLE "Rule" ADD CONSTRAINT "Rule_businessPhoneNumberId_fkey" FOREIGN KEY ("businessPhoneNumberId") REFERENCES "BusinessPhoneNumber"("id") ON DELETE CASCADE ON UPDATE CASCADE;
