/*
  Warnings:

  - You are about to drop the column `opposed` on the `Action` table. All the data in the column will be lost.

*/
-- DropIndex
DROP INDEX "Action_locationId_idx";

-- DropIndex
DROP INDEX "ArchiveEntry_content_trgm_idx";

-- DropIndex
DROP INDEX "DirectMessage_content_trgm_idx";

-- AlterTable
ALTER TABLE "Action" DROP COLUMN "opposed",
ADD COLUMN     "farmPlan" JSONB;

-- AlterTable
ALTER TABLE "Character" ADD COLUMN     "hungerValue" INTEGER NOT NULL DEFAULT 100,
ADD COLUMN     "starvingSinceTurn" INTEGER;

-- AlterTable
ALTER TABLE "GameConfig" ALTER COLUMN "locationMoveCooldownSeconds" SET DEFAULT 3,
ADD COLUMN     "farmMaxCrops" INTEGER NOT NULL DEFAULT 50;

-- AlterTable
ALTER TABLE "Tag" ADD COLUMN     "mealHunger" INTEGER;
