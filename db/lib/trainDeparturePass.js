// The train leaves, and everything in the drop box goes with it.
//
// Selling used to be the Merchant sending a shuttle up with whatever was
// standing on the pad, paid into the station's own float. It is a box in the
// Railyard now: anybody drops anything in, the item is gone the moment they do,
// and this pass turns the row it left behind into money at the next departure.
//
// Three things land, and they are three different movements:
//   - the seller's net, into whichever account the row named;
//   - the Meister's cut, as coin into the Keep's Vault;
//   - the coin BACKING any credit to a TREASURY account, also into the Vault,
//     because a claim this pass mints has to be worth something at the counter.
//
// Runs every OTHER turn (db/lib/train.js). Parity decides whether the pass runs;
// what settles is decided entirely by `settledAt: null`, so a resumed or doubled
// advance cannot pay a sale twice.

const { addToRoomStack } = require("./tagWrites");
const { isDepartureTurn } = require("./train");
const { loadDepot } = require("./depotState");
const { bumpBankAccount, vaultAndCoin, TREASURY } = require("./bankAccounts");
const { roomParty, COMPANY, turnStamp } = require("./economyLedger");
const { MERCHANT_LICENSE_SLUG } = require("./depot");

const TRAIN_DEPARTED_LINE = {
  text: "You hear the train leave.",
  signed: false,
};

// The Meister's cut, rounded. A rate of 0 takes nothing and writes no row.
function taxOn(gross, rate) {
  const pct = Math.max(0, Math.min(100, Math.trunc(rate ?? 0)));
  if (!pct) return 0;
  return Math.min(gross, Math.round((gross * pct) / 100));
}

// Whose account MERCHANT pays into. The licence, never the role — the licence
// is tradeable and a role check would quietly break that, the same call
// /depot's own gate makes.
async function merchantAccount(prisma) {
  const holder = await prisma.character.findFirst({
    where: { status: "ALIVE", tags: { some: { tag: { slug: MERCHANT_LICENSE_SLUG } } } },
    orderBy: { createdAt: "asc" },
    select: { bankAccount: true },
  });
  return holder?.bankAccount ?? null;
}

async function runTrainDeparturePass(prisma, turn) {
  if (!isDepartureTurn(turn?.number)) return { ran: false, settled: 0, paid: 0, taxed: 0 };

  const sales = await prisma.depotSale.findMany({
    where: { settledAt: null },
    orderBy: { createdAt: "asc" },
    include: { account: true },
  });
  if (!sales.length) return { ran: true, settled: 0, paid: 0, taxed: 0 };

  const [depot, { room: vault, coin }, merchant] = await Promise.all([
    loadDepot(prisma),
    vaultAndCoin(prisma),
    merchantAccount(prisma),
  ]);

  const stamp = turnStamp(turn);
  const vaultParty = vault ? roomParty({ ...vault, zoneId: vault.location?.zoneId ?? null }) : null;

  let settled = 0;
  let paid = 0;
  let taxed = 0;

  for (const sale of sales) {
    const gross = Math.max(0, Math.trunc(sale.unitPrice) * Math.trunc(sale.quantity));
    const tax = taxOn(gross, depot?.sellTaxRate);
    const net = gross - tax;

    // Where the net goes. A MERCHANT row with no licensed character left alive
    // falls back to the seller rather than evaporating — the goods were real.
    const target =
      sale.destination === "MERCHANT" ? (merchant ?? sale.account) : sale.destination === "SELF" ? sale.account : null;
    const toVault = sale.destination === "TREASURY";

    try {
      await prisma.$transaction(async (tx) => {
        const { count } = await tx.depotSale.updateMany({
          where: { id: sale.id, settledAt: null },
          data: {
            settledAt: new Date(),
            settledTurn: turn.number,
            grossObols: gross,
            taxObols: tax,
            netObols: net,
          },
        });
        if (!count) return;

        // The Meister's cut. Coin, into the Vault, never into an account — so
        // the Keep's stash grows by exactly what the sellers were docked.
        if (tax > 0 && vault && coin) {
          await addToRoomStack(tx, vault.id, coin.id, tax, {
            econ: { from: COMPANY, to: vaultParty, reason: "SELL_TAX", roomId: vault.id, ...stamp },
          });
        }

        if (net > 0 && toVault && vault && coin) {
          // Paid straight into the Keep's treasury as coin. No account leg —
          // a Room IS a treasury in this codebase.
          await addToRoomStack(tx, vault.id, coin.id, net, {
            econ: { from: COMPANY, to: vaultParty, reason: "DEPOT_SALE", roomId: vault.id, ...stamp },
          });
          paid += net;
        } else if (net > 0 && target) {
          await bumpBankAccount(tx, target.id, net, {
            holderName: target.holderName,
            reason: "DEPOT_SALE",
            econ: { other: COMPANY, reason: "DEPOT_SALE", ...stamp },
          });
          // A TREASURY claim is only worth the coin behind it, so minting one
          // has to put that coin in the Vault in the SAME transaction. An
          // OFFSHORE claim needs none — that money is held off-world.
          if (target.class === TREASURY && vault && coin) {
            await addToRoomStack(tx, vault.id, coin.id, net, {
              econ: { from: COMPANY, to: vaultParty, reason: "DEPOT_SALE", roomId: vault.id, ...stamp },
            });
          }
          paid += net;
        }

        taxed += tax;
        settled += 1;
      });
    } catch (err) {
      // One bad row must not strand the rest. It stays unsettled and rides the
      // next departure, since the claim rolled back with everything else.
      console.error(`Train settlement failed for sale ${sale.id}:`, err?.message ?? err);
    }
  }

  return { ran: true, settled, paid, taxed, lines: settled > 0 ? [TRAIN_DEPARTED_LINE] : [] };
}

module.exports = { runTrainDeparturePass, TRAIN_DEPARTED_LINE, taxOn };
