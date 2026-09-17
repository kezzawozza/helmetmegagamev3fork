import { redirect } from "next/navigation";
import PageShell from "@/app/components/PageShell";
import TreasuryDesk from "./TreasuryDesk";
import { prisma, loadDepot, vaultObols, TREASURY } from "@lifeweb/db";
import { canReadTreasury } from "@lifeweb/db/lib/depotCounter";
import { getGmSession } from "@/lib/discordGuild";
import { isSuperadmin } from "@/lib/superadmin";

// The Meister's terminal: every account in Ravenheart, what the Vault actually
// holds against them, and the one number he sets.
//
// Gated on PLACE AND KEY rather than on a tag or the Meister role: you have to
// be standing in the Keep and able to get through the office door
// (`canReadTreasury`, db/lib/depotCounter.js). The terminal is a thing on a
// desk, so reaching the desk is the permission — which also means walking out
// of the Keep takes the page away again, and the nav rail follows it.
//
// A superadmin reads it as host access, the way /lifeweb works, but does not
// get the dial; actions.js re-checks the real gate either way.
//
// This replaced the Tax button, which filed a levy per person per turn and was
// answered by a DM. The sell tax is quieter and much harder to dodge: it comes
// off every sale at the counter before anybody is paid, and it lands in the
// Vault as coin. See docs/systemdocs/DEPOT.md §8.
export default async function TreasuryPage() {
  const { session } = await getGmSession();
  if (!session?.discordUserId) redirect("/");

  const superadmin = isSuperadmin(session.discordUserId);
  const gate = await canReadTreasury(prisma, session.discordUserId);
  if (!gate.ok && !superadmin) redirect("/character");
  const holder = gate.ok;

  const [depot, accounts, coin, staged] = await Promise.all([
    loadDepot(prisma),
    prisma.bankAccount.findMany({
      orderBy: { balanceObols: "desc" },
      select: {
        id: true,
        fingerprint: true,
        holderName: true,
        class: true,
        balanceObols: true,
        character: { select: { status: true, role: { select: { name: true } } } },
      },
    }),
    vaultObols(prisma),
    prisma.depotSale.findMany({ where: { settledAt: null }, select: { unitPrice: true, quantity: true } }),
  ]);

  const claims = accounts
    .filter((a) => a.class === TREASURY)
    .reduce((sum, a) => sum + a.balanceObols, 0);
  const stagedValue = staged.reduce((sum, s) => sum + s.unitPrice * s.quantity, 0);

  return (
    <PageShell width="wide">
      <TreasuryDesk
        rate={depot.sellTaxRate ?? 0}
        vaultObols={coin}
        claims={claims}
        stagedValue={stagedValue}
        readOnly={!holder}
        accounts={accounts.map((a) => ({
          id: a.id,
          fingerprint: a.fingerprint,
          holderName: a.holderName,
          class: a.class,
          balanceObols: a.balanceObols,
          roleName: a.character?.role?.name ?? "",
          status: a.character?.status ?? "",
        }))}
      />
    </PageShell>
  );
}
