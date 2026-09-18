// Read-only: does the Keep's Vault actually hold what the Treasury accounts
// claim? `npm run db:audit-vault-backing`.
//
// This is NOT reconcile's job and must never be folded into it. reconcile()
// compares ledger legs against live balances, form by form; it never looks at
// COIN at all, so a Health row claiming it checked the backing would be lying.
// This is the separate question: a claim is only worth the coin behind it, and
// under the line somebody walks up to the ATM and is told no through no fault
// of their own. See docs/systemdocs/ECONOMY.md §3.
//
// EXITS 1 when the Vault is short, so it can be a check rather than a readout.
require("dotenv").config();
const { prisma } = require("../../index");
const { vaultObols, VAULT_ROOM_SLUG } = require("../../lib/bankAccounts");

async function main() {
  const room = await prisma.room.findUnique({ where: { slug: VAULT_ROOM_SLUG }, select: { id: true, name: true } });
  if (!room) {
    console.error(`No "${VAULT_ROOM_SLUG}" room. Run npm run db:import-zones -- --apply first.`);
    process.exitCode = 1;
    return;
  }

  const [coin, accounts] = await Promise.all([
    vaultObols(prisma),
    prisma.bankAccount.findMany({
      where: { class: "TREASURY" },
      select: { fingerprint: true, holderName: true, balanceObols: true },
      orderBy: { balanceObols: "desc" },
    }),
  ]);

  const claims = accounts.reduce((sum, a) => sum + a.balanceObols, 0);

  console.log(`${room.name}: ${coin} ¢`);
  console.log(`Treasury claims: ${claims} ¢ across ${accounts.length} account(s)`);

  for (const a of accounts.slice(0, 10)) {
    if (a.balanceObols > 0) console.log(`  ${a.fingerprint}  ${a.holderName}  ${a.balanceObols} ¢`);
  }

  if (coin < claims) {
    console.error(`SHORT BY ${claims - coin} ¢. Withdrawals will start being refused.`);
    process.exitCode = 1;
    return;
  }
  console.log(`Backed, with ${coin - claims} ¢ of slack.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
