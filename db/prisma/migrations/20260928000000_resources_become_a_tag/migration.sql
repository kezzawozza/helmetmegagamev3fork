-- Resources become an item.
--
-- Character.resources and Room.resources were Int columns holding a ⬢ balance
-- that weighed nothing and could not be picked up. ⬢ are a Tag now (`resources`,
-- one pound a unit, docs/tags.yaml), held in the ordinary CharacterTag/RoomTag
-- stacks, so stashing, handing over, stealing, looting and the Overburdened
-- shed all stopped needing a ⬢-shaped special case.
--
-- The carry cap that counted them separately goes with them: GameConfig
-- .carryResourceCap and Character.carryResourcesSeen existed only to police a
-- balance that had no weight. It has weight now, so carryWeightLbs is the one
-- cap and carryWeightSeen the one watermark.

-- Carry the balances across FIRST, where there is anything to carry and the
-- catalog already holds the tag. On a database that has never run
-- `npm run db:sync-tags` there is no `resources` Tag row to point a stack at,
-- so this is a no-op and the balances simply go — which is the right trade
-- pre-launch, where every balance is seed data, and is why this is not
-- attempted as a hand-built Tag INSERT (Tag carries a dozen NOT NULL columns
-- this migration has no business inventing).
DO $$
DECLARE
  tag_id TEXT;
BEGIN
  SELECT "id" INTO tag_id FROM "Tag" WHERE "slug" = 'resources';
  IF tag_id IS NULL THEN
    RAISE NOTICE 'No "resources" tag yet - balances are not carried over. Run npm run db:sync-tags.';
    RETURN;
  END IF;

  -- Merge rather than insert blindly: a stack may already exist if the tag was
  -- synced and handled before this migration ran.
  INSERT INTO "CharacterTag" ("id", "characterId", "tagId", "source", "acquiredAt", "quantity")
  SELECT gen_random_uuid()::text, c."id", tag_id, 'EVENT', NOW(), c."resources"
  FROM "Character" c
  WHERE c."resources" > 0
  ON CONFLICT ("characterId", "tagId")
  DO UPDATE SET "quantity" = "CharacterTag"."quantity" + EXCLUDED."quantity";

  INSERT INTO "RoomTag" ("id", "roomId", "tagId", "quantity", "updatedAt")
  SELECT gen_random_uuid()::text, r."id", tag_id, r."resources", NOW()
  FROM "Room" r
  WHERE r."resources" > 0
  ON CONFLICT ("roomId", "tagId")
  DO UPDATE SET "quantity" = "RoomTag"."quantity" + EXCLUDED."quantity";

  -- The new pounds are part of the carried load, so fold them into the
  -- watermark too. Without this every holder reads as having just acquired
  -- their whole balance and the next settleCarry sheds it onto the floor.
  UPDATE "Character" c
  SET "carryWeightSeen" = c."carryWeightSeen" + c."resources"
  WHERE c."resources" > 0;
END $$;

ALTER TABLE "Character" DROP COLUMN "resources";
ALTER TABLE "Character" DROP COLUMN "carryResourcesSeen";
ALTER TABLE "Room" DROP COLUMN "resources";
ALTER TABLE "GameConfig" DROP COLUMN "carryResourceCap";
