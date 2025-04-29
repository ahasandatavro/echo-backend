/*
  Warnings:

  - You are about to drop the column `scheduledDate` on the `Broadcast` table. All the data in the column will be lost.
  - You are about to drop the column `scheduledTime` on the `Broadcast` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Broadcast" DROP COLUMN "scheduledDate",
DROP COLUMN "scheduledTime",
ADD COLUMN     "scheduledDateTime" TIMESTAMP(3);
