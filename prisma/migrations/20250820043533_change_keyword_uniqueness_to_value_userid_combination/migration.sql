/*
  Warnings:

  - A unique constraint covering the columns `[value,userId]` on the table `Keyword` will be added. If there are existing duplicate values, this will fail.

*/
-- DropIndex
DROP INDEX "Keyword_value_key";

-- CreateIndex
CREATE UNIQUE INDEX "Keyword_value_userId_key" ON "Keyword"("value", "userId");
