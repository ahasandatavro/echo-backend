/*
  Warnings:

  - A unique constraint covering the columns `[userId]` on the table `NotificationSetting` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateIndex
CREATE UNIQUE INDEX "NotificationSetting_userId_key" ON "NotificationSetting"("userId");
