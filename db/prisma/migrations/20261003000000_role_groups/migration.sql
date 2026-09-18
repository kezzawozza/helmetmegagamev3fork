-- Roles stop hanging off a Faction and hang off the character-creation
-- picker's own grouping instead (db/lib/roleGroups.js, docs/roles.yaml's
-- `groups:` keys). Split from the drop that follows it so this one can be
-- applied by `migrate deploy` on a database that still has factions: the
-- column is backfilled here, before db:sync-roles ever reads it.
ALTER TABLE "Role" ADD COLUMN "groupSlug" TEXT NOT NULL DEFAULT 'other';

UPDATE "Role" r SET "groupSlug" = CASE f."slug"
    WHEN 'the-court' THEN 'court'
    WHEN 'the-church' THEN 'clergy'
    WHEN 'order-of-the-silver-cross' THEN 'clergy'
    WHEN 'cerberon' THEN 'cerberon'
    WHEN 'the-sanctuary' THEN 'saviors'
    WHEN 'the-company' THEN 'business'
    WHEN 'the-factory' THEN 'business'
    WHEN 'the-town' THEN 'soil'
    WHEN 'the-inn' THEN 'soil'
    WHEN 'brigands' THEN 'outsiders'
    WHEN 'unaffiliated' THEN 'outsiders'
    ELSE 'other'
  END
  FROM "Faction" f
 WHERE f."id" = r."factionId";

-- The Fisherman reads as a man alone with a rod rather than as one of the
-- Factory's books. This used to be ROLE_GROUP_OVERRIDES in db/lib/roleGroups.js;
-- the YAML names the group outright now.
UPDATE "Role" SET "groupSlug" = 'soil' WHERE "slug" = 'fisherman';

CREATE INDEX "Role_groupSlug_idx" ON "Role"("groupSlug");
