-- CreateTable
CREATE TABLE "KeywordTemplate" (
    "id" SERIAL NOT NULL,
    "keywordId" INTEGER NOT NULL,
    "templateId" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KeywordTemplate_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "KeywordTemplate" ADD CONSTRAINT "KeywordTemplate_keywordId_fkey" FOREIGN KEY ("keywordId") REFERENCES "Keyword"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "KeywordTemplate" ADD CONSTRAINT "KeywordTemplate_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;
