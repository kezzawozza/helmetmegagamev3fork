import { describeTurn } from "@/lib/turnFormat";
import { GAME_YEAR } from "@lifeweb/db/turnCalendar";
import LockChip from "./LockChip";
import BascinetClock from "./BascinetClock";

// The bar's own clock, behind its own divider (AppBar.js): "Day 14 · 1098 ·
// Turn 27 · 10:28 PM", plus the Moves-lock countdown when a turn is open.
// This replaces the old TurnMeta.js, which also carried the zone — the bar
// no longer says where you are that way, since the active link already does.
//
// A server component inside its own Suspense boundary (AppBar.js) so a slow
// turn query never holds the nav links off the screen; it awaits nothing
// else, unlike TurnMeta, which also loaded the viewer's zone.
export default async function ClockBlock({ turnPromise }) {
  const turn = await turnPromise;
  const { day } = describeTurn(turn);
  return (
    <span className="top-bar-clock">
      <span className="header-note mono">
        {turn ? `Day ${day} · ${GAME_YEAR} · Turn ${turn.number}` : "NO TURN OPEN"}
      </span>
      <BascinetClock />
      <LockChip />
    </span>
  );
}
