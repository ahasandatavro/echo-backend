-- CreateTable
CREATE TABLE "TemplateClick" (
    "id" SERIAL NOT NULL,
    "templateId" INTEGER NOT NULL,
    "clickCount" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TemplateClick_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TemplateClick_templateId_key" ON "TemplateClick"("templateId");

-- AddForeignKey
ALTER TABLE "TemplateClick" ADD CONSTRAINT "TemplateClick_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "Template"("id") ON DELETE CASCADE ON UPDATE CASCADE;
