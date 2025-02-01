-- AlterTable
ALTER TABLE "Contact" ADD COLUMN     "sendSMS" BOOLEAN DEFAULT false,
ADD COLUMN     "subscribed" BOOLEAN DEFAULT false;
