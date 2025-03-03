/*
  Warnings:

  - You are about to drop the `_BroadcastContacts` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "BroadcastStatus" AS ENUM ('SENT', 'DELIVERED', 'READ', 'FAILED');

-- DropForeignKey
ALTER TABLE "_BroadcastContacts" DROP CONSTRAINT "_BroadcastContacts_A_fkey";

-- DropForeignKey
ALTER TABLE "_BroadcastContacts" DROP CONSTRAINT "_BroadcastContacts_B_fkey";

-- DropTable
DROP TABLE "_BroadcastContacts";

-- CreateTable
CREATE TABLE "BroadcastRecipient" (
    "id" SERIAL NOT NULL,
    "broadcastId" INTEGER NOT NULL,
    "contactId" INTEGER NOT NULL,
    "status" "BroadcastStatus" NOT NULL DEFAULT 'SENT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BroadcastRecipient_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "BroadcastRecipient" ADD CONSTRAINT "BroadcastRecipient_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "Broadcast"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastRecipient" ADD CONSTRAINT "BroadcastRecipient_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
