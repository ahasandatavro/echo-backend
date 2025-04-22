-- DropForeignKey
ALTER TABLE "NotificationSetting" DROP CONSTRAINT "NotificationSetting_businessPhoneNumberId_fkey";

-- AlterTable
ALTER TABLE "NotificationSetting" ALTER COLUMN "businessPhoneNumberId" DROP NOT NULL;

-- AddForeignKey
ALTER TABLE "NotificationSetting" ADD CONSTRAINT "NotificationSetting_businessPhoneNumberId_fkey" FOREIGN KEY ("businessPhoneNumberId") REFERENCES "BusinessPhoneNumber"("id") ON DELETE SET NULL ON UPDATE CASCADE;
