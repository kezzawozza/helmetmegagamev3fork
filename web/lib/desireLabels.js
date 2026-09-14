// Client-safe (no db import) wording for a Desire slot still on cooldown. "Locked (1t)" rather than
// "Opens on turn 3" — a player knows what one more day means, not what turn it is.
// `lockedTurnsLeft` is computed in db/lib/desireGates.js#slotStates.
export function lockedSlotLabel(slot) {
  const n = slot?.lockedTurnsLeft ?? 1;
  return `Locked (${n}t)`;
}
