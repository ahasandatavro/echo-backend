/*
  Warnings:

  - A unique constraint covering the columns `[metaPhoneNumberId]` on the table `BusinessPhoneNumber` will be added. If there are existing duplicate values, this will fail.

*/
-- CreateTable
CREATE TABLE "RoundRobinState" (
    "id" TEXT NOT NULL,
    "phoneNumberId" TEXT NOT NULL,
    "lastAssignedIndex" INTEGER NOT NULL,

    CONSTRAINT "RoundRobinState_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "RoundRobinState_phoneNumberId_key" ON "RoundRobinState"("phoneNumberId");

-- CreateIndex
CREATE UNIQUE INDEX "BusinessPhoneNumber_metaPhoneNumberId_key" ON "BusinessPhoneNumber"("metaPhoneNumberId");

-- AddForeignKey
ALTER TABLE "RoundRobinState" ADD CONSTRAINT "RoundRobinState_phoneNumberId_fkey" FOREIGN KEY ("phoneNumberId") REFERENCES "BusinessPhoneNumber"("metaPhoneNumberId") ON DELETE RESTRICT ON UPDATE CASCADE;
