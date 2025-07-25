-- CreateTable
CREATE TABLE "NodeVisit" (
    "id" SERIAL NOT NULL,
    "conversationId" INTEGER NOT NULL,
    "nodeId" INTEGER NOT NULL,
    "contactId" INTEGER,
    "enteredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leftAt" TIMESTAMP(3),

    CONSTRAINT "NodeVisit_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "NodeVisit" ADD CONSTRAINT "NodeVisit_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeVisit" ADD CONSTRAINT "NodeVisit_nodeId_fkey" FOREIGN KEY ("nodeId") REFERENCES "Node"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NodeVisit" ADD CONSTRAINT "NodeVisit_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE SET NULL ON UPDATE CASCADE;
