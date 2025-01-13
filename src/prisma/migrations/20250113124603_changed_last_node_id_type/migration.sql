/*
  Warnings:

  - The `lastNodeId` column on the `Conversation` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "Conversation" DROP COLUMN "lastNodeId",
ADD COLUMN     "lastNodeId" INTEGER;
