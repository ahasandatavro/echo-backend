-- CreateTable
CREATE TABLE "BusinessAccount" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "userId" INTEGER NOT NULL,
    "timeZone" TEXT,
    "businessName" TEXT,
    "businessVerification" TEXT,
    "accountStatus" TEXT,
    "paymentMethod" TEXT,
    "metaAccessToken" TEXT,
    "metaWabaId" TEXT,

    CONSTRAINT "BusinessAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BusinessPhoneNumber" (
    "id" SERIAL NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "businessAccountId" INTEGER NOT NULL,
    "phoneNumber" TEXT,
    "metaPhoneNumberId" TEXT NOT NULL,
    "displayName" TEXT,
    "connectionStatus" TEXT,
    "subscription" TEXT,

    CONSTRAINT "BusinessPhoneNumber_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "BusinessAccount_userId_key" ON "BusinessAccount"("userId");

-- AddForeignKey
ALTER TABLE "BusinessAccount" ADD CONSTRAINT "BusinessAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "BusinessPhoneNumber" ADD CONSTRAINT "BusinessPhoneNumber_businessAccountId_fkey" FOREIGN KEY ("businessAccountId") REFERENCES "BusinessAccount"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
