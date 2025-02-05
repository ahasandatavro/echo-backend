-- CreateTable
CREATE TABLE "_ContactTeams" (
    "A" INTEGER NOT NULL,
    "B" INTEGER NOT NULL,

    CONSTRAINT "_ContactTeams_AB_pkey" PRIMARY KEY ("A","B")
);

-- CreateIndex
CREATE INDEX "_ContactTeams_B_index" ON "_ContactTeams"("B");

-- AddForeignKey
ALTER TABLE "_ContactTeams" ADD CONSTRAINT "_ContactTeams_A_fkey" FOREIGN KEY ("A") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ContactTeams" ADD CONSTRAINT "_ContactTeams_B_fkey" FOREIGN KEY ("B") REFERENCES "Team"("id") ON DELETE CASCADE ON UPDATE CASCADE;
