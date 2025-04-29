-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "BroadcastStatus" ADD VALUE 'PENDING';
ALTER TYPE "BroadcastStatus" ADD VALUE 'SCHEDULED';

-- AlterTable
ALTER TABLE "Broadcast" ADD COLUMN     "scheduledDate" TEXT,
ADD COLUMN     "scheduledTime" TEXT,
ADD COLUMN     "sentAt" TIMESTAMP(3),
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'PENDING';
