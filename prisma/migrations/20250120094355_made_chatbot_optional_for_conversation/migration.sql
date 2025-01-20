-- DropForeignKey
ALTER TABLE "Conversation" DROP CONSTRAINT "Conversation_chatbotId_fkey";

-- AlterTable
ALTER TABLE "Conversation" ALTER COLUMN "chatbotId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "Chatbot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
