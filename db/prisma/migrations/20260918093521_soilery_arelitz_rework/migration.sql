-- AlterTable
ALTER TABLE "Action" ADD COLUMN     "breakInPlan" JSONB;

-- AlterTable
ALTER TABLE "GameConfig" ADD COLUMN     "stableCapacity" INTEGER NOT NULL DEFAULT 10,
ADD COLUMN     "stableOverflowRoomSlug" TEXT NOT NULL DEFAULT 'farms-fields';

-- AlterTable
ALTER TABLE "Room" ADD COLUMN     "stable" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Tag" ADD COLUMN     "mealTaste" TEXT,
ADD COLUMN     "mealTasteForm" TEXT,
ADD COLUMN     "requirementYield" INTEGER;
