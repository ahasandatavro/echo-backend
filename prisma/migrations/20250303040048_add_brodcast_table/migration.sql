-- CreateTable
CREATE TABLE "Broadcast" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "templateName" TEXT NOT NULL,
    "userId" INTEGER NOT NULL,
    "phoneNumberId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Broadcast_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "_BroadcastContacts" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_BroadcastContacts_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_BroadcastContacts_B_index" ON "_BroadcastContacts"("B");

-- AddForeignKey
ALTER TABLE "_BroadcastContacts" ADD CONSTRAINT "_BroadcastContacts_A_fkey" FOREIGN KEY ("A") REFERENCES "Broadcast"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_BroadcastContacts" ADD CONSTRAINT "_BroadcastContacts_B_fkey" FOREIGN KEY ("B") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
