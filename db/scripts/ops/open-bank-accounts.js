// Opens a fingerprinted bank account for every living character whose role
// carries `bank_account:` in docs/roles.yaml, and closes the retired Depot
// float out on the ledger.
//
// `npm run db:open-bank-accounts` to preview, `-- --apply` to write. Idempotent:
// openAccount() hands back the account that is already there, so a second run
// is a no-op rather than a second account.
//
// The one thing SQL could not do in the migration is the ledger row. The
// migration moved `Depot.accountObols` into the Merchant's OFFSHORE account
// directly, which leaves `depot:account` reading as though its float simply
// vanished — a permanent drift the size of his balance on /gm/economy's Health
// section, and, worse, a lesson that the drift numbers are noise. record()
// needs the reason table and the turn stamp, so the closing row is written
// here instead. See docs/systemdocs/ECONOMY.md §3.
require("dotenv").config();
const { prisma } = require("../../index");
const { openAccount, loadAccount } = require("../../lib/bankAccounts");
const { record, DEPOT_ACCOUNT, bankParty } = require("../../lib/economyLedger");

const APPLY = process.argv.includes("--apply");

async function main() {
  const characters = await prisma.character.findMany({
    where: { status: "ALIVE", role: { bankAccountClass: { not: null } } },
    select: { id: true, name: true, role: { select: { slug: true, bankAccountClass: true } } },
    orderBy: { createdAt: "asc" },
  });

  const turn = await prisma.turn.findFirst({ where: { closedAt: null }, orderBy: { number: "desc" } });

  let opened = 0;
  let already = 0;

  for (const character of characters) {
    const existing = await loadAccount(prisma, character.id);
    if (existing) {
      already += 1;
      continue;
    }
    opened += 1;
    if (!APPLY) {
      console.log(`  would open ${character.role.bankAccountClass} for ${character.name} (${character.role.slug})`);
      continue;
    }
    const row = await openAccount(prisma, character, {
      accountClass: character.role.bankAccountClass,
      turnNumber: turn?.number ?? null,
    });
    console.log(`  opened ${row.class} ${row.fingerprint} for ${character.name}`);
  }

  // The seam. Any account the migration moved the float into gets one row
  // saying where it came from, so `depot:account` nets to nothing rather than
  // drifting by its old balance forever.
  const merchant = await prisma.bankAccount.findFirst({
    where: { class: "OFFSHORE", balanceObols: { gt: 0 } },
    orderBy: { createdAt: "asc" },
  });
  const seamDone = merchant
    ? await prisma.economyEntry.findFirst({
        where: { reason: "OPENING", form: "ACCOUNT", toId: merchant.id },
        select: { id: true },
      })
    : null;

  if (merchant && !seamDone) {
    if (!APPLY) {
      console.log(`  would close depot:account out into ${merchant.fingerprint} (${merchant.balanceObols} ¢)`);
    } else {
      await prisma.$transaction(async (tx) => {
        await record(
          tx,
          { from: DEPOT_ACCOUNT, to: bankParty(merchant), form: "ACCOUNT", amount: merchant.balanceObols },
          { reason: "OPENING", turnId: turn?.id ?? null, turnNumber: turn?.number ?? null },
        );
      });
      console.log(`  closed depot:account out into ${merchant.fingerprint} (${merchant.balanceObols} ¢)`);
    }
  }

  console.log(
    `${APPLY ? "Opened" : "Would open"} ${opened} account(s); ${already} already had one.` +
      (APPLY ? "" : "  (dry run — pass -- --apply to write)"),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
