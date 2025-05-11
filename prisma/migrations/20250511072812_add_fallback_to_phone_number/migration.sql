-- AlterTable
ALTER TABLE "BusinessPhoneNumber" ADD COLUMN     "fallbackEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "fallbackMessage" TEXT,
ADD COLUMN     "fallbackTriggerCount" INTEGER NOT NULL DEFAULT 3;
