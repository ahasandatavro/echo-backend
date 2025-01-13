-- CreateTable
CREATE TABLE "Conversation" (
    "id" SERIAL NOT NULL,
    "recipient" TEXT NOT NULL,
    "chatbotId" INTEGER NOT NULL,
    "lastNodeId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "Chatbot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
