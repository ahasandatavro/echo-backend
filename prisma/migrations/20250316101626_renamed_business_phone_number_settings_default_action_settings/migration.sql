/*
  Warnings:

  - You are about to drop the `BusinessPhoneNumberSettings` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "BusinessPhoneNumberSettings" DROP CONSTRAINT "BusinessPhoneNumberSettings_businessPhoneNumberId_fkey";

-- DropTable
DROP TABLE "BusinessPhoneNumberSettings";

-- CreateTable
CREATE TABLE "DefaultActionSettings" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "businessPhoneNumberId" INTEGER NOT NULL,
    "workingHours" JSONB,
    "outsideWorkingHoursEnabled" BOOLEAN NOT NULL DEFAULT false,
    "noAgentOnlineEnabled" BOOLEAN NOT NULL DEFAULT false,
    "fallbackMessageEnabled" BOOLEAN NOT NULL DEFAULT false,
    "noResponseAfter24hEnabled" BOOLEAN NOT NULL DEFAULT false,
    "outsideWorkingHoursMaterialId" INTEGER,
    "outsideWorkingHoursMaterialType" TEXT,
    "noAgentOnlineMaterialId" INTEGER,
    "noAgentOnlineMaterialType" TEXT,
    "fallbackMessageMaterialId" INTEGER,
    "fallbackMessageMaterialType" TEXT,
    "noResponseAfter24hMaterialId" INTEGER,
    "noResponseAfter24hMaterialType" TEXT,
    "expiredChatReassignmentDisabled" BOOLEAN NOT NULL DEFAULT false,
    "noKeywordMatchReplyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "roundRobinAssignmentEnabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "DefaultActionSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "DefaultActionSettings_businessPhoneNumberId_key" ON "DefaultActionSettings"("businessPhoneNumberId");

-- AddForeignKey
ALTER TABLE "DefaultActionSettings" ADD CONSTRAINT "DefaultActionSettings_businessPhoneNumberId_fkey" FOREIGN KEY ("businessPhoneNumberId") REFERENCES "BusinessPhoneNumber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
