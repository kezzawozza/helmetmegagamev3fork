"use client";

import StatusPill from "@/app/components/StatusPill";
import { useInboxStreamState } from "./players/inboxStreamStore";
import { useDeskStreamState } from "./turns/deskStreamStore";

// Says so when a desk's live channel has dropped to its backstop poll —
// shared shape for the player desk's inbox and the adjudication desk's
// channel. Renders nothing while up. Labels differ per desk and come in as
// props; `InboxStreamChip`/`DeskStreamChip` below are the actual call sites.
function StreamStatusChip({ state, fatalLabel, warnLabel, fatalTitle, warnTitle }) {
  if (state === "live") return null;
  const fatal = state === "fatal";
  // A warning, not a neutral label — must not be indistinguishable from the turn chip beside it.
  return (
    <StatusPill tone={fatal ? "bad" : "warn"} title={fatal ? fatalTitle : warnTitle}>
      {fatal ? fatalLabel : warnLabel}
    </StatusPill>
  );
}

// PLAYER-DESK.md §9a. Still correct when this shows (the 30s poll carries it) — just says it's on the slow path.
export function InboxStreamChip() {
  const state = useInboxStreamState();
  return (
    <StreamStatusChip
      state={state}
      fatalLabel="Live feed off"
      warnLabel="Catching up"
      fatalTitle="The live connection could not be opened — you may be signed out. New mail still arrives every 30 seconds; reload to restore the live feed."
      warnTitle="The live connection dropped and is retrying. New mail still arrives, just up to 30 seconds behind."
    />
  );
}

// The turns desk's twin — still correct when this shows (120s poll in
// Workspace.js carries it), but another GM's staging can be two minutes stale.
export function DeskStreamChip() {
  const state = useDeskStreamState();
  return (
    <StreamStatusChip
      state={state}
      fatalLabel="Live desk off"
      warnLabel="Catching up"
      fatalTitle="The live connection could not be opened — you may be signed out. Your own work still saves and shows; other GMs' staging arrives every two minutes. Reload to restore the live desk."
      warnTitle="The live connection dropped and is retrying. Your own work is unaffected; other GMs' staging may be up to two minutes behind."
    />
  );
}
