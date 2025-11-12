-- CreateTable
CREATE TABLE "ConversationChatbotTrigger" (
    "id" SERIAL NOT NULL,
    "conversationId" INTEGER NOT NULL,
    "chatbotId" INTEGER NOT NULL,
    "triggeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userType" TEXT NOT NULL,
    "businessPhoneNumberId" INTEGER,

    CONSTRAINT "ConversationChatbotTrigger_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ConversationChatbotTrigger_conversationId_idx" ON "ConversationChatbotTrigger"("conversationId");

-- CreateIndex
CREATE INDEX "ConversationChatbotTrigger_chatbotId_triggeredAt_idx" ON "ConversationChatbotTrigger"("chatbotId", "triggeredAt");

-- CreateIndex
CREATE INDEX "ConversationChatbotTrigger_businessPhoneNumberId_chatbotId__idx" ON "ConversationChatbotTrigger"("businessPhoneNumberId", "chatbotId", "triggeredAt");

-- CreateIndex
CREATE INDEX "ConversationChatbotTrigger_userType_idx" ON "ConversationChatbotTrigger"("userType");

-- AddForeignKey
ALTER TABLE "ConversationChatbotTrigger" ADD CONSTRAINT "ConversationChatbotTrigger_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationChatbotTrigger" ADD CONSTRAINT "ConversationChatbotTrigger_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "Chatbot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ConversationChatbotTrigger" ADD CONSTRAINT "ConversationChatbotTrigger_businessPhoneNumberId_fkey" FOREIGN KEY ("businessPhoneNumberId") REFERENCES "BusinessPhoneNumber"("id") ON DELETE SET NULL ON UPDATE CASCADE;
