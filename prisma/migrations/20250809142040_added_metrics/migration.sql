-- AlterTable
ALTER TABLE "Broadcast" ADD COLUMN     "apiType" TEXT NOT NULL DEFAULT 'CLOUD',
ADD COLUMN     "buttonClicks" JSONB,
ADD COLUMN     "templateId" TEXT,
ADD COLUMN     "totalClicked" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totalDelivered" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totalRead" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totalReplied" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "totalSent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "websiteClicks" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "BroadcastMetric" (
    "id" SERIAL NOT NULL,
    "broadcastId" INTEGER NOT NULL,
    "metricType" TEXT NOT NULL,
    "metricValue" INTEGER NOT NULL DEFAULT 1,
    "contactId" INTEGER,
    "buttonId" TEXT,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BroadcastMetric_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "BroadcastMetric" ADD CONSTRAINT "BroadcastMetric_broadcastId_fkey" FOREIGN KEY ("broadcastId") REFERENCES "Broadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BroadcastMetric" ADD CONSTRAINT "BroadcastMetric_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
