/*
  Warnings:

  - The `triggered` column on the `Chatbot` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - The `finished` column on the `Chatbot` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "Chatbot" DROP COLUMN "triggered",
ADD COLUMN     "triggered" INTEGER DEFAULT 0,
ALTER COLUMN "stepsFinished" SET DEFAULT 0,
DROP COLUMN "finished",
ADD COLUMN     "finished" INTEGER DEFAULT 0;
