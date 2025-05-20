-- AlterTable
ALTER TABLE "ReplyMaterial" ADD COLUMN     "businessPhoneNumberId" INTEGER;

-- AddForeignKey
ALTER TABLE "ReplyMaterial" ADD CONSTRAINT "ReplyMaterial_businessPhoneNumberId_fkey" FOREIGN KEY ("businessPhoneNumberId") REFERENCES "BusinessPhoneNumber"("id") ON DELETE SET NULL ON UPDATE CASCADE;
