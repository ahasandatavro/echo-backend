/*
  Warnings:

  - A unique constraint covering the columns `[latestChatStatusId]` on the table `Contact` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateEnum
CREATE TYPE "ChatStatus" AS ENUM ('OPENED', 'EXPIRED', 'SOLVED', 'PENDING', 'IN_PROGRESS');

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "latestChatStatusId" INTEGER;

-- CreateTable
CREATE TABLE "ChatStatusHistory" (
    "id" SERIAL NOT NULL,
    "contactId" INTEGER NOT NULL,
    "conversationId" INTEGER,
    "status" "ChatStatus" NOT NULL,
    "changedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatStatusHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Contact_latestChatStatusId_key" ON "Contact"("latestChatStatusId");

-- AddForeignKey
ALTER TABLE "Contact" ADD CONSTRAINT "Contact_latestChatStatusId_fkey" FOREIGN KEY ("latestChatStatusId") REFERENCES "ChatStatusHistory"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatStatusHistory" ADD CONSTRAINT "ChatStatusHistory_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatStatusHistory" ADD CONSTRAINT "ChatStatusHistory_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE SET NULL ON UPDATE CASCADE;
