// Client-safe on purpose: MoveDesk.js needs this predicate without dragging in the Prisma barrel
// (web/lib/moveRows.js/referenceData.js), which would kill the desk at load. No imports here, ever.

// Does anything staged actually reach this character? Mirrors db/lib/stagedPush.js's own test so the
// desk's warning and the push's fallback can never disagree. The Result box does NOT count — it is
// GM-facing and never sent; a Move whose outcome lives only there reaches the player as silence.
export function stagingReaches(characterId, { messages = [], effects = [] } = {}) {
  if (!characterId) return false;
  return (
    messages.some(
      (m) => m.kind === "PRIVATE" && (m.recipients ?? []).some((r) => r.characterId === characterId),
    ) || effects.some((e) => e.targetCharacterId === characterId)
  );
}
