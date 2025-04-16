-- CreateTable
CREATE TABLE "NotificationSetting" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "businessPhoneNumberId" INTEGER NOT NULL,
    "newChatDesktop" BOOLEAN NOT NULL DEFAULT true,
    "newMessageDesktop" BOOLEAN NOT NULL DEFAULT true,
    "assignedAgentDesktop" BOOLEAN NOT NULL DEFAULT true,
    "messageAssignedDesktop" BOOLEAN NOT NULL DEFAULT true,
    "chatAssignedTeamDesktop" BOOLEAN NOT NULL DEFAULT true,
    "newChatSound" BOOLEAN NOT NULL DEFAULT true,
    "newMessageSound" BOOLEAN NOT NULL DEFAULT true,
    "assignedAgentSound" BOOLEAN NOT NULL DEFAULT true,
    "messageAssignedSound" BOOLEAN NOT NULL DEFAULT true,
    "chatAssignedTeamSound" BOOLEAN NOT NULL DEFAULT true,
    "selectedSound" TEXT NOT NULL DEFAULT 'Alert',

    CONSTRAINT "NotificationSetting_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "NotificationSetting_businessPhoneNumberId_key" ON "NotificationSetting"("businessPhoneNumberId");

-- AddForeignKey
ALTER TABLE "NotificationSetting" ADD CONSTRAINT "NotificationSetting_businessPhoneNumberId_fkey" FOREIGN KEY ("businessPhoneNumberId") REFERENCES "BusinessPhoneNumber"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
