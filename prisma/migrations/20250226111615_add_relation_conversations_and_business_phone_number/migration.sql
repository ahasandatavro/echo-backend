-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "businessPhoneNumberId" INTEGER;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_businessPhoneNumberId_fkey" FOREIGN KEY ("businessPhoneNumberId") REFERENCES "BusinessPhoneNumber"("id") ON DELETE SET NULL ON UPDATE CASCADE;
