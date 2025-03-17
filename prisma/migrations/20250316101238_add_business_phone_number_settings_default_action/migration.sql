-- CreateTable
CREATE TABLE "BusinessPhoneNumberSettings" (
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

    CONSTRAINT "BusinessPhoneNumberSettings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessPhoneNumberSettings_businessPhoneNumberId_key" ON "BusinessPhoneNumberSettings"("businessPhoneNumberId");

-- AddForeignKey
ALTER TABLE "BusinessPhoneNumberSettings" ADD CONSTRAINT "BusinessPhoneNumberSettings_businessPhoneNumberId_fkey" FOREIGN KEY ("businessPhoneNumberId") REFERENCES "BusinessPhoneNumber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
