-- AlterTable
ALTER TABLE "BusinessAccount" ADD COLUMN     "contentDirection" TEXT,
ADD COLUMN     "holidayMode" BOOLEAN DEFAULT false,
ADD COLUMN     "language" TEXT,
ADD COLUMN     "supportButtonEnabled" BOOLEAN DEFAULT false,
ADD COLUMN     "supportButtonWebsite" TEXT;
