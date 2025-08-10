-- CreateTable
CREATE TABLE "BroadcastRecipientHistory" (
    "id" SERIAL NOT NULL,
    "broadcastRecipientId" INTEGER NOT NULL,
    "status" "BroadcastStatus" NOT NULL,
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BroadcastRecipientHistory_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "BroadcastRecipientHistory_broadcastRecipientId_idx" ON "BroadcastRecipientHistory"("broadcastRecipientId");

-- CreateIndex
CREATE INDEX "BroadcastRecipientHistory_createdAt_idx" ON "BroadcastRecipientHistory"("createdAt");

-- AddForeignKey
ALTER TABLE "BroadcastRecipientHistory" ADD CONSTRAINT "BroadcastRecipientHistory_broadcastRecipientId_fkey" FOREIGN KEY ("broadcastRecipientId") REFERENCES "BroadcastRecipient"("id") ON DELETE CASCADE ON UPDATE CASCADE;
