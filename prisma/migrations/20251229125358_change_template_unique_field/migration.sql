/*
  Warnings:

  - A unique constraint covering the columns `[name,wabaId,userId]` on the table `Template` will be added. If there are existing duplicate values, this will fail.
  - Made the column `wabaId` on table `Template` required. This step will fail if there are existing NULL values in that column.

*/
-- DropIndex
DROP INDEX "Template_name_key";

-- AlterTable
ALTER TABLE "Template" ALTER COLUMN "wabaId" SET NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "Template_name_wabaId_userId_key" ON "Template"("name", "wabaId", "userId");
