-- AlterTable
ALTER TABLE "ChatStatusHistory" ADD COLUMN     "assignedToTeamId" INTEGER,
ADD COLUMN     "assignedToUserId" INTEGER,
ADD COLUMN     "note" TEXT,
ADD COLUMN     "type" TEXT NOT NULL DEFAULT 'statusChanged';

-- AddForeignKey
ALTER TABLE "ChatStatusHistory" ADD CONSTRAINT "ChatStatusHistory_assignedToUserId_fkey" FOREIGN KEY ("assignedToUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChatStatusHistory" ADD CONSTRAINT "ChatStatusHistory_assignedToTeamId_fkey" FOREIGN KEY ("assignedToTeamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;
