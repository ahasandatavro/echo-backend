/*
  Warnings:

  - The values [ASSIGN_USER,ASSIGN_TEAM,NOTIFICATION] on the enum `MaterialType` will be removed. If these variants are still used in the database, this will fail.

*/
-- AlterEnum
BEGIN;
CREATE TYPE "MaterialType_new" AS ENUM ('TEXT', 'IMAGE', 'VIDEO', 'DOCUMENT', 'STICKER', 'CONTACT_ATTRIBUTES', 'Notification', 'AssignUser', 'AssignTeam');
ALTER TABLE "ReplyMaterial" ALTER COLUMN "type" TYPE "MaterialType_new" USING ("type"::text::"MaterialType_new");
ALTER TYPE "MaterialType" RENAME TO "MaterialType_old";
ALTER TYPE "MaterialType_new" RENAME TO "MaterialType";
DROP TYPE "MaterialType_old";
COMMIT;
