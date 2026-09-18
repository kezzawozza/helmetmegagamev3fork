-- Configurable turn length, Sessions, and the end of Dawn/Dusk.
-- See docs/systemdocs/TURN-ENGINE.md and docs/systemdocs/SESSIONS.md.
--
-- Ordering matters here: every column that READS TurnPhase is backfilled before
-- the enum is dropped, so the migration is safe to stop halfway.

-- 1. The game type.
CREATE TYPE "GameMode" AS ENUM ('PERSISTENT', 'SESSIONS');

ALTER TABLE "GameConfig"
  ADD COLUMN "turnLengthHours" INTEGER NOT NULL DEFAULT 24,
  ADD COLUMN "gameMode" "GameMode" NOT NULL DEFAULT 'PERSISTENT';

-- 2. The next session window. Per-game, so Restart Game clears it for free.
ALTER TABLE "GameState"
  ADD COLUMN "sessionScheduledStartAt" TIMESTAMP(3),
  ADD COLUMN "sessionScheduledEndAt"   TIMESTAMP(3),
  ADD COLUMN "sessionOpenedAt"         TIMESTAMP(3),
  ADD COLUMN "sessionClosedAt"         TIMESTAMP(3);

-- 3. The turn's own clock. Added nullable, backfilled, then made NOT NULL where
--    the schema says so — the three-step every backfill on a non-empty table has
--    to take.
ALTER TABLE "Turn"
  ADD COLUMN "dayNumber"       INTEGER,
  ADD COLUMN "turnLengthHours" INTEGER NOT NULL DEFAULT 24,
  ADD COLUMN "endsAt"          TIMESTAMP(3);

-- Every existing row was a 24-hour turn under the Dawn/Dusk alternation, where
-- an in-game day was two turns. ceil(number / 2) is exactly what the code used
-- to compute on the fly, so this preserves every day number already shown to a
-- player, every archive divider, and every once-a-day claim token
-- (Character.birdTurnId, Character.extractDayKey, Character.fastTravelTurnId).
UPDATE "Turn" SET "dayNumber" = CEIL("number"::numeric / 2)::integer WHERE "dayNumber" IS NULL;

ALTER TABLE "Turn" ALTER COLUMN "dayNumber" SET NOT NULL;

-- `endsAt` is deliberately left NULL on old rows. db/lib/turnClock.js#turnEndsAt
-- falls back to deriving it from startedAt for exactly these, which reproduces
-- the old midnight-boundary answer; writing a value here would be guessing.

-- 4. ArchiveEntry stops snapshotting the phase and starts snapshotting the day.
--    /archive and db/lib/objectives.js read the day off this row with no Turn
--    join, and it is no longer derivable from the turn number.
ALTER TABLE "ArchiveEntry" ADD COLUMN "dayNumber" INTEGER;

UPDATE "ArchiveEntry"
   SET "dayNumber" = CEIL("turnNumber"::numeric / 2)::integer
 WHERE "turnNumber" IS NOT NULL AND "dayNumber" IS NULL;

ALTER TABLE "ArchiveEntry" DROP COLUMN "turnPhase";

-- 5. Dawn and Dusk themselves. Nothing reads Turn.phase after step 4, and
--    Turn.gameDate has been dead for some time — it was written as the wall
--    clock at creation and read by nothing (startedAt is the real stamp).
ALTER TABLE "Turn"
  DROP COLUMN "phase",
  DROP COLUMN "gameDate";

DROP TYPE "TurnPhase";

-- SystemReportKind.DAWN_WIPE is deliberately NOT renamed: SystemReport rows
-- already carry the value, and renaming an enum value that history holds is the
-- mistake the "lessons" turn-pass key exists to remember. The Dev Panel labels
-- it "Summary wipe" instead.
