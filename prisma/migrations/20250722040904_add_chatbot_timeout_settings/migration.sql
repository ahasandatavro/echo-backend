-- AlterTable
ALTER TABLE "BusinessPhoneNumber" ADD COLUMN     "enableExitNotification" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "exitNotificationLeadTime" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN     "exitNotificationMessage" TEXT NOT NULL DEFAULT 'Please type or select from the options above if you would like to continue, else this conversation will reset and you may have to share your responses again.',
ADD COLUMN     "timeoutMinutes" INTEGER NOT NULL DEFAULT 30;
