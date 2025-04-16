-- AlterTable
ALTER TABLE "DefaultActionSettings" ADD COLUMN     "waitingMessageEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "waitingMessageMaterialId" INTEGER,
ADD COLUMN     "waitingMessageMaterialType" TEXT,
ADD COLUMN     "welcomeMessageEnabled" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "welcomeMessageMaterialId" INTEGER,
ADD COLUMN     "welcomeMessageMaterialType" TEXT;
