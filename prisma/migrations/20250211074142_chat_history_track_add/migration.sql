/*
  Warnings:

  - You are about to drop the column `status` on the `ChatStatusHistory` table. All the data in the column will be lost.
  - Added the required column `newStatus` to the `ChatStatusHistory` table without a default value. This is not possible if the table is not empty.

*/
-- DropForeignKey
ALTER TABLE "ChatStatusHistory" DROP CONSTRAINT "ChatStatusHistory_contactId_fkey";

-- DropForeignKey
ALTER TABLE "Contact" DROP CONSTRAINT "Contact_latestChatStatusId_fkey";

-- AlterTable
ALTER TABLE "ChatStatusHistory" DROP COLUMN "status",
ADD COLUMN     "changedById" INTEGER,
ADD COLUMN     "newStatus" TEXT NOT NULL,
ADD COLUMN     "previousStatus" TEXT,
ADD COLUMN     "timerEndTime" TIMESTAMP(3),
ADD COLUMN     "timerStartTime" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "lastMessageTime" TIMESTAMP(3),
ADD COLUMN     "ticketStatus" TEXT,
ADD COLUMN     "timerEndTime" TIMESTAMP(3),
ADD COLUMN     "timerStartTime" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "ChatStatusHistory" ADD CONSTRAINT "ChatStatusHistory_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatStatusHistory" ADD CONSTRAINT "ChatStatusHistory_changedById_fkey" FOREIGN KEY ("changedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
