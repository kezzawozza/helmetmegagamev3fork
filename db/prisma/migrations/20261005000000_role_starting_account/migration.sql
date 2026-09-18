-- A seat can open its bank account with money in it.
--
-- Until now an account opened EMPTY, always, and a starting purse was physical
-- obols in `starting_tags`. The reason was good: a TREASURY balance is a hard
-- claim on the coin sitting in the Keep's Vault, and seeding one would have
-- been a claim with nothing behind it -- the exact failure the backing exists
-- to prevent.
--
-- The answer is to back it rather than to refuse it. The Vault's seed in
-- docs/zones.yaml rises from 350 to 480 in the same change, which covers every
-- purse a full game hands out with room left over for the town, and
-- `npm run db:audit-vault-backing` is the check that keeps it honest.
--
-- The tiers below are station, not balance: the Baron is rich, a courtier is
-- comfortable, a commoner has pocket change, and a slave or a migrant has
-- nothing. The Merchant's 55 is the largest and costs the Vault nothing at
-- all, because his account is OFFSHORE.
--
-- NOT NULL DEFAULT 0 so `migrate deploy` applies this to a populated table
-- without a rewrite pass deciding anything by hand. Every seat not named below
-- keeps that 0, which is right for the five seats that hold no account.

ALTER TABLE "Role" ADD COLUMN "startingAccountObols" INTEGER NOT NULL DEFAULT 0;

UPDATE "Role" SET "startingAccountObols" = 36 WHERE "slug" = 'baron';
UPDATE "Role" SET "startingAccountObols" = 55 WHERE "slug" = 'merchant';
UPDATE "Role" SET "startingAccountObols" = 14 WHERE "slug" = 'pusher';
UPDATE "Role" SET "startingAccountObols" = 6  WHERE "slug" = 'baroness';
UPDATE "Role" SET "startingAccountObols" = 5  WHERE "slug" = 'hand';
UPDATE "Role" SET "startingAccountObols" = 4  WHERE "slug" = 'meister';

-- The rest of the court.
UPDATE "Role" SET "startingAccountObols" = 5
 WHERE "slug" IN ('heir', 'successor', 'arbiter', 'courtier', 'minstrel', 'servant');

-- The named seats the game cannot open without, minus the ones priced above.
-- brigand-leader is one of these and is deliberately absent: it holds no
-- account, so it has nowhere to put the money.
UPDATE "Role" SET "startingAccountObols" = 6
 WHERE "slug" IN ('bishop', 'inquisitor', 'censor', 'esculap', 'banneret', 'exactor', 'headman', 'innkeeper');

-- Everybody else who holds an account. Migrant is excluded on purpose: they
-- arrive in Ravenheart with nothing, which is the whole of the seat.
UPDATE "Role" SET "startingAccountObols" = 3
 WHERE "bankAccountClass" IS NOT NULL
   AND "startingAccountObols" = 0
   AND "slug" <> 'migrant';
