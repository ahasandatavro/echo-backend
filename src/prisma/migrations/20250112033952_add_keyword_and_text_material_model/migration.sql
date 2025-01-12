-- CreateEnum
CREATE TYPE "MatchType" AS ENUM ('FUZZY', 'EXACT', 'CONTAINS');

-- CreateTable
CREATE TABLE "Keyword" (
    "id" SERIAL NOT NULL,
    "value" TEXT NOT NULL,
    "chatbotId" INTEGER,
    "textId" INTEGER,
    "matchType" "MatchType" NOT NULL,
    "fuzzyPercent" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Keyword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TextMaterial" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TextMaterial_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Keyword_value_key" ON "Keyword"("value");

-- AddForeignKey
ALTER TABLE "Keyword" ADD CONSTRAINT "Keyword_chatbotId_fkey" FOREIGN KEY ("chatbotId") REFERENCES "Chatbot"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Keyword" ADD CONSTRAINT "Keyword_textId_fkey" FOREIGN KEY ("textId") REFERENCES "TextMaterial"("id") ON DELETE SET NULL ON UPDATE CASCADE;
