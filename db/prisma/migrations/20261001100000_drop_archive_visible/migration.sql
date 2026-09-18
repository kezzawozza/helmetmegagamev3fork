-- The archive is a GM tool now, never player-viewable. There is no longer a
-- toggle that opens a game's transcript to players, so GameState.archiveVisible
-- is dead: nothing sets it, nothing reads it. `web/lib/archiveAccess.js`
-- requires a GM unconditionally instead.

ALTER TABLE "GameState" DROP COLUMN "archiveVisible";
