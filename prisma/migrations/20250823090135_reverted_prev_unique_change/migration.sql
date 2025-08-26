/*
  Warnings:

  - A unique constraint covering the columns `[name]` on the table `Template` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Template_name_userId_wabaId_key";

-- CreateIndex
CREATE UNIQUE INDEX "Template_name_key" ON "Template"("name");
