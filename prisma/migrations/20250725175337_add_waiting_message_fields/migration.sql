-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "lastAgentMessageAt" TIMESTAMP(3),
ADD COLUMN     "waitingJobId" TEXT,
ADD COLUMN     "waitingMessageSent" BOOLEAN NOT NULL DEFAULT false;
