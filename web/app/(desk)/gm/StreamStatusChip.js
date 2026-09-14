"use client";

import StatusPill from "@/app/components/StatusPill";
import { useInboxStreamState } from "./players/inboxStreamStore";
import { useDeskStreamState } from "./turns/deskStreamStore";

// Says so when a desk's live channel has dropped to its backstop poll.
//
// Shared shape for the player desk's inbox stream and the adjudication
// desk's own channel — a dropped stream that looks alive is worse than one
// that never existed. Renders nothing while the stream is up, which is
// almost always. Labels are the one thing that differs between the two
// desks, so they come in as props; `InboxStreamChip` and `DeskStreamChip`
// below are the two desks' actual call sites, each just its hook plus its
// own words.
function StreamStatusChip({ state, fatalLabel, warnLabel, fatalTitle, warnTitle }) {
  if (state === "live") return null;
  const fatal = state === "fatal";
  // A warning, not a neutral label: the desk is running on its backstop
  // poll. It used to be a plain .chip, indistinguishable from the turn
  // chip beside it, which is the one thing a dropped stream must not be.
  return (
    <StatusPill tone={fatal ? "bad" : "warn"} title={fatal ? fatalTitle : warnTitle}>
      {fatal ? fatalLabel : warnLabel}
    </StatusPill>
  );
}

// PLAYER-DESK.md §9a's objection to a push feed: "a dropped stream that
// looks alive is exactly the failure class this desk has already been
// burned by". The desk is still correct when this shows (the 30s poll
// carries it) — this just says it is running on the slow path.
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

// The turns desk's twin, for the same reason: the desk is still correct when
// this shows (the 120s poll in Workspace.js carries it, and a GM's own work
// never depended on either) — but another GM's staging can now be two
// minutes stale, and that is worth a word.
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
