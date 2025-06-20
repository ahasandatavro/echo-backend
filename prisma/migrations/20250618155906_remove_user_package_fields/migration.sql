/*
  Warnings:

  - You are about to drop the column `currentPackage` on the `User` table. All the data in the column will be lost.
  - You are about to drop the column `packageExpiryDate` on the `User` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "User" DROP COLUMN "currentPackage",
DROP COLUMN "packageExpiryDate";
