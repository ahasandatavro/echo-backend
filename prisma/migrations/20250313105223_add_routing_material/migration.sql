-- CreateEnum
CREATE TYPE "RoutingType" AS ENUM ('Notification', 'AssignUser', 'AssignTeam');

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isOnline" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "lastActive" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "RoutingMaterial" (
    "id" SERIAL NOT NULL,
    "type" "RoutingType" NOT NULL,
    "materialName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "assignedUserId" INTEGER,
    "teamId" INTEGER,

    CONSTRAINT "RoutingMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_RoutingMaterialUsers" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_RoutingMaterialUsers_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_RoutingMaterialUsers_B_index" ON "_RoutingMaterialUsers"("B");

-- AddForeignKey
ALTER TABLE "RoutingMaterial" ADD CONSTRAINT "RoutingMaterial_assignedUserId_fkey" FOREIGN KEY ("assignedUserId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RoutingMaterial" ADD CONSTRAINT "RoutingMaterial_teamId_fkey" FOREIGN KEY ("teamId") REFERENCES "Team"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RoutingMaterialUsers" ADD CONSTRAINT "_RoutingMaterialUsers_A_fkey" FOREIGN KEY ("A") REFERENCES "RoutingMaterial"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_RoutingMaterialUsers" ADD CONSTRAINT "_RoutingMaterialUsers_B_fkey" FOREIGN KEY ("B") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
