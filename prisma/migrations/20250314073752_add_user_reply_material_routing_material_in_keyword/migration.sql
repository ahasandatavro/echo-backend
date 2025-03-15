/*
  Warnings:

  - You are about to drop the column `replyMaterialId` on the `Keyword` table. All the data in the column will be lost.

*/
-- DropForeignKey
ALTER TABLE "Keyword" DROP CONSTRAINT "Keyword_replyMaterialId_fkey";

-- AlterTable
ALTER TABLE "Keyword" DROP COLUMN "replyMaterialId",
ADD COLUMN     "userId" INTEGER;

-- CreateTable
CREATE TABLE "KeywordReplyMaterial" (
    "id" SERIAL NOT NULL,
    "keywordId" INTEGER NOT NULL,
    "replyMaterialId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KeywordReplyMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "KeywordRoutingMaterial" (
    "id" SERIAL NOT NULL,
    "keywordId" INTEGER NOT NULL,
    "routingMaterialId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KeywordRoutingMaterial_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Keyword" ADD CONSTRAINT "Keyword_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordReplyMaterial" ADD CONSTRAINT "KeywordReplyMaterial_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "Keyword"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordReplyMaterial" ADD CONSTRAINT "KeywordReplyMaterial_replyMaterialId_fkey" FOREIGN KEY ("replyMaterialId") REFERENCES "ReplyMaterial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordRoutingMaterial" ADD CONSTRAINT "KeywordRoutingMaterial_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "Keyword"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordRoutingMaterial" ADD CONSTRAINT "KeywordRoutingMaterial_routingMaterialId_fkey" FOREIGN KEY ("routingMaterialId") REFERENCES "RoutingMaterial"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
