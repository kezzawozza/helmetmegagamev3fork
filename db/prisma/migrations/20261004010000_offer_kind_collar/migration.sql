-- The bomb collar's consent handshake (docs/systemdocs/COLLAR.md). Apply Collar
-- asks anybody who could refuse, and rides the shared Offer table and the
-- shared offer:accept:/offer:decline: button prefixes -- so the whole of the
-- schema change is one more value in the enum.
--
-- IF NOT EXISTS so a re-run is a no-op; ALTER TYPE ... ADD VALUE cannot run
-- inside a transaction block on older Postgres, and Prisma's migrate deploy
-- wraps each migration, which is why this is its own file with nothing else in
-- it to roll back alongside.
ALTER TYPE "OfferKind" ADD VALUE IF NOT EXISTS 'COLLAR';
