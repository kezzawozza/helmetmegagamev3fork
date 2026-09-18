-- Roles become readable off a look again.
--
-- Examining somebody stopped printing their role when factions were removed
-- (20261003010000_remove_factions): a title used to ride on sharing a faction,
-- and with factions gone there was no reader left entitled to one. That went
-- too far. Most seats in this game are public offices -- the Bishop, the
-- Sheriff, the Innkeeper are known to be what they are -- so the default is
-- that a look reads the title.
--
-- The exceptions are the seats whose whole point is not being known: the two
-- Brigands and the two Tribunal seats. They carry `examine_visible: false` in
-- docs/roles.yaml and land here as false, and nothing else in the game reads
-- them out to a player.
--
-- NOT NULL DEFAULT true so `migrate deploy` applies this to a populated table
-- without a rewrite pass deciding anything by hand.

ALTER TABLE "Role" ADD COLUMN "examineVisible" BOOLEAN NOT NULL DEFAULT true;

UPDATE "Role" SET "examineVisible" = false
 WHERE "slug" IN ('brigand-leader', 'brigand', 'tribunal-ordinator', 'tribune');
