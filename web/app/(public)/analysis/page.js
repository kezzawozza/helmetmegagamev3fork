import Link from "next/link";
import { auth } from "@/lib/auth";
import PageShell from "@/app/components/PageShell";
import AppHeader from "@/app/components/AppHeader";
import AnalysisView from "./AnalysisView";
import {
  summaryStats,
  claimsByCharacter,
  mostPowerfulByTier,
  mostPowerfulByTotalPoints,
  catalogCoverage,
  claimsByFamily,
  claimsByTier,
  claimsByTurn,
  pointsConcentration,
  rejectedClaims,
  rejectedClaimsByTurn,
  oncePerLifeExhaustion,
  freeformClaims,
  rawClaims,
} from "@/lib/desireQuery";

// Unlisted on purpose: never added to PLAYER_NAV/GM_NAV (web/lib/navItems.js),
// no auth gate (lives in (public), same posture as /handbook), reachable only
// by knowing this exact URL. A one-person balance-analysis tool over every
// Desire ever claimed — see docs/systemdocs/DESIRES.md and web/lib/desireQuery.js.
export const metadata = {
  title: "Desire Analysis",
  description: "desire claim analytics",
  robots: { index: false, follow: false },
};

export default async function AnalysisPage() {
  const session = await auth();
  const signedIn = !!session?.discordUserId;

  const [
    summary,
    byCharacter,
    byTierPower,
    byPointsPower,
    coverage,
    byFamily,
    byTier,
    byTurn,
    rejected,
    rejectedByTurn,
    onceEver,
    freeform,
    raw,
  ] = await Promise.all([
    summaryStats(),
    claimsByCharacter(),
    mostPowerfulByTier(),
    mostPowerfulByTotalPoints(),
    catalogCoverage(),
    claimsByFamily(),
    claimsByTier(),
    claimsByTurn(),
    rejectedClaims(),
    rejectedClaimsByTurn(),
    oncePerLifeExhaustion(),
    freeformClaims(),
    rawClaims(),
  ]);

  // Pure reshape of byCharacter — no extra query (see desireQuery.js).
  const concentration = pointsConcentration(byCharacter);

  return (
    <>
      <AppHeader title="Desire Analysis" />
      <PageShell width="wide">
        {!signedIn && (
          <p className="text-sm text-muted">
            Playing already? <Link href="/">Sign in</Link> to reach your character, the map, and the
            rest of the site.
          </p>
        )}
        <AnalysisView
          summary={summary}
          byCharacter={byCharacter}
          byTierPower={byTierPower}
          byPointsPower={byPointsPower}
          coverage={coverage}
          byFamily={byFamily}
          byTier={byTier}
          byTurn={byTurn}
          concentration={concentration}
          rejected={rejected}
          rejectedByTurn={rejectedByTurn}
          onceEver={onceEver}
          freeform={freeform}
          raw={raw}
        />
      </PageShell>
    </>
  );
}
