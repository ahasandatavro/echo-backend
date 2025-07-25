-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "lastCustomerMessageAt" TIMESTAMP(3),
ADD COLUMN     "noResponse24hJobId" TEXT,
ADD COLUMN     "noResponse24hSent" BOOLEAN NOT NULL DEFAULT false;
