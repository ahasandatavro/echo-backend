/*
  Warnings:

  - You are about to drop the `TextMaterial` table. If the table is not empty, all the data it contains will be lost.

*/
-- CreateEnum
CREATE TYPE "MaterialType" AS ENUM ('TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT', 'STICKER');

-- DropForeignKey
ALTER TABLE "Keyword" DROP CONSTRAINT "Keyword_textId_fkey";

-- AlterTable
ALTER TABLE "Keyword" ADD COLUMN     "replyMaterialId" INTEGER;

-- DropTable
DROP TABLE "TextMaterial";

-- CreateTable
CREATE TABLE "ReplyMaterial" (
    "id" SERIAL NOT NULL,
    "type" "MaterialType" NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT,
    "fileUrl" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ReplyMaterial_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "Keyword" ADD CONSTRAINT "Keyword_replyMaterialId_fkey" FOREIGN KEY ("replyMaterialId") REFERENCES "ReplyMaterial"("id") ON DELETE SET NULL ON UPDATE CASCADE;
