/*
  Warnings:

  - The `responseBody` column on the `WebhookLog` table would be dropped and recreated. This will lead to data loss if there is data in the column.

*/
-- AlterTable
ALTER TABLE "WebhookLog" DROP COLUMN "responseBody",
ADD COLUMN     "responseBody" JSONB;
