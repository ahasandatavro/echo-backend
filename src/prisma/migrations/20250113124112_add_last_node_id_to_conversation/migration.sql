/*
  Warnings:

  - Added the required column `currentNodeId` to the `Conversation` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "currentNodeId" INTEGER NOT NULL;
