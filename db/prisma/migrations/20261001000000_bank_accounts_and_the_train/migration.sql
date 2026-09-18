-- Bank accounts, the train, and the end of the shuttle.
--
-- The Depot stops being one man's console. Everybody with a town seat gets a
-- fingerprinted BankAccount; most are TREASURY class, hard-backed by real obol
-- tags in the Keep's Vault. The Merchant's and the Docker's are OFFSHORE, which
-- is where `Depot.accountObols` goes: the station's float becomes his account,
-- so the two pots the ATM sat between are one pot and one purse now.
--
-- Orders stop being one JSON blob on the Depot row and become DepotOrder rows,
-- one per buyer. Selling stops being the Merchant's private act and becomes
-- DepotSale rows staged in the Railyard's drop box. Both settle on a train that
-- runs on a fixed every-other-turn cycle nobody calls, which is what kills the
-- shuttle, the landing pad and the generator that could take the whole market
-- down for a day.
--
-- The tax button goes with it. PendingTax and its enum are dropped outright:
-- the Meister's terminal and Depot.sellTaxRate replace them.

-- ─── The new tables ───

CREATE TYPE "BankAccountClass" AS ENUM ('TREASURY', 'OFFSHORE');
CREATE TYPE "DepotSaleDestination" AS ENUM ('SELF', 'TREASURY', 'MERCHANT');

CREATE TABLE "BankAccount" (
  "id" TEXT NOT NULL,
  "characterId" TEXT NOT NULL,
  "class" "BankAccountClass" NOT NULL DEFAULT 'TREASURY',
  "balanceObols" INTEGER NOT NULL DEFAULT 0,
  "fingerprint" TEXT NOT NULL,
  "holderName" TEXT NOT NULL,
  "openedTurn" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BankAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BankAccount_characterId_key" ON "BankAccount"("characterId");
CREATE UNIQUE INDEX "BankAccount_fingerprint_key" ON "BankAccount"("fingerprint");
ALTER TABLE "BankAccount" ADD CONSTRAINT "BankAccount_characterId_fkey"
  FOREIGN KEY ("characterId") REFERENCES "Character"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DepotOrder" (
  "id" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "holderName" TEXT NOT NULL,
  "anonymous" BOOLEAN NOT NULL DEFAULT false,
  "lines" JSONB NOT NULL,
  "totalObols" INTEGER NOT NULL,
  "manifestId" TEXT NOT NULL,
  "placedTurn" INTEGER NOT NULL,
  "deliveredAt" TIMESTAMP(3),
  "deliveredTurn" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DepotOrder_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DepotOrder_deliveredAt_idx" ON "DepotOrder"("deliveredAt");
CREATE INDEX "DepotOrder_accountId_idx" ON "DepotOrder"("accountId");
ALTER TABLE "DepotOrder" ADD CONSTRAINT "DepotOrder_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "BankAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "DepotSale" (
  "id" TEXT NOT NULL,
  "accountId" TEXT,
  "fingerprint" TEXT NOT NULL,
  "holderName" TEXT NOT NULL,
  "destination" "DepotSaleDestination" NOT NULL DEFAULT 'SELF',
  "tagId" TEXT,
  "tagName" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "unitPrice" INTEGER NOT NULL,
  "droppedTurn" INTEGER NOT NULL,
  "settledAt" TIMESTAMP(3),
  "settledTurn" INTEGER,
  "grossObols" INTEGER,
  "taxObols" INTEGER,
  "netObols" INTEGER,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DepotSale_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "DepotSale_settledAt_idx" ON "DepotSale"("settledAt");
CREATE INDEX "DepotSale_accountId_idx" ON "DepotSale"("accountId");
ALTER TABLE "DepotSale" ADD CONSTRAINT "DepotSale_accountId_fkey"
  FOREIGN KEY ("accountId") REFERENCES "BankAccount"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─── The catalog ───

-- Which manifest a ware sits on. NULL is the Merchant's own, so every existing
-- row keeps the old behaviour: he stocks it and nobody else is offered it.
ALTER TABLE "Tag" ADD COLUMN "manifest" TEXT;

-- ─── The Depot ───

ALTER TABLE "Depot" ADD COLUMN "sellTaxRate" INTEGER NOT NULL DEFAULT 0;

-- The station's float becomes the Merchant's OFFSHORE account, where there is a
-- Merchant to give it to. Best-effort by design: on a database with no licensed
-- character the float simply goes, which is the right trade pre-launch. The
-- ledger row closing out `depot:account` is written by
-- `node db/scripts/ops/open-bank-accounts.js --apply`, not here — record()
-- needs the reason table and the turn stamp, which SQL has no reach into.
DO $$
DECLARE
  merchant_id TEXT;
  float_obols INTEGER;
BEGIN
  SELECT "accountObols" INTO float_obols FROM "Depot" WHERE "id" = 1;
  IF float_obols IS NULL OR float_obols = 0 THEN
    RETURN;
  END IF;

  SELECT c."id" INTO merchant_id
  FROM "Character" c
  JOIN "CharacterTag" ct ON ct."characterId" = c."id"
  JOIN "Tag" t ON t."id" = ct."tagId"
  WHERE t."slug" = 'merchants-license' AND c."status" = 'ALIVE'
  ORDER BY c."createdAt" ASC
  LIMIT 1;

  IF merchant_id IS NULL THEN
    RAISE NOTICE 'No licensed character - the station float is not carried over.';
    RETURN;
  END IF;

  INSERT INTO "BankAccount" ("id", "characterId", "class", "balanceObols", "fingerprint", "holderName", "updatedAt")
  SELECT gen_random_uuid()::text, c."id", 'OFFSHORE', float_obols, 'RV-0001-M', c."name", NOW()
  FROM "Character" c WHERE c."id" = merchant_id
  ON CONFLICT ("characterId")
  DO UPDATE SET "balanceObols" = "BankAccount"."balanceObols" + EXCLUDED."balanceObols",
                "class" = 'OFFSHORE';
END $$;

ALTER TABLE "Depot" DROP COLUMN "accountObols";
ALTER TABLE "Depot" DROP COLUMN "manifest";
ALTER TABLE "Depot" DROP COLUMN "generatorOn";
ALTER TABLE "Depot" DROP COLUMN "generatorFuel";
ALTER TABLE "Depot" DROP COLUMN "fuelMax";
ALTER TABLE "Depot" DROP COLUMN "fuelBurnPerTurn";
ALTER TABLE "Depot" DROP COLUMN "coalFuel";
ALTER TABLE "Depot" DROP COLUMN "saltpeterFuel";
ALTER TABLE "Depot" DROP COLUMN "shuttleState";
ALTER TABLE "Depot" DROP COLUMN "shuttleTurn";
ALTER TABLE "Depot" DROP COLUMN "shuttleMaxTurns";
ALTER TABLE "Depot" DROP COLUMN "shuttleCooldown";

-- Only once no column is typed on it: Postgres refuses to drop a type in use.
DROP TYPE "ShuttleState";

-- ─── The tax button ───

DROP TABLE "PendingTax";
DROP TYPE "PendingTaxKind";

-- Which kind of account a seat opens with, from docs/roles.yaml's
-- `bank_account:`. Null is no account, which is what the Black Hills seats get.
ALTER TABLE "Role" ADD COLUMN "bankAccountClass" "BankAccountClass";
