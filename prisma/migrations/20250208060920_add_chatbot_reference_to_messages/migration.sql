-- AlterTable
ALTER TABLE "Message" ADD COLUMN     "chatbotId" INTEGER,
ADD COLUMN     "messageType" TEXT NOT NULL DEFAULT 'text';

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "Chatbot"("id") ON DELETE SET NULL ON UPDATE CASCADE;
