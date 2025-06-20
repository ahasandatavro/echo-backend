/*
  Warnings:

  - You are about to drop the column `packageName` on the `Payment` table. All the data in the column will be lost.
  - Added the required column `metadata` to the `Payment` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Payment" DROP COLUMN "packageName",
ADD COLUMN     "metadata" JSONB NOT NULL,
ADD COLUMN     "paymentType" TEXT NOT NULL DEFAULT 'upgrade-package';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "currentPackage" TEXT,
ADD COLUMN     "packageExpiryDate" TIMESTAMP(3);
