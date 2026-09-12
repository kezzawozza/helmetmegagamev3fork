// What a hop costs, in the fewest words that fit under a node.
//
// Lives here rather than in TravelNodes.js because there are two surfaces
// offering the same crossing now — the Travel panel's "ways out" grid and
// /map — and a second copy of this would drift the moment somebody tuned one.
// Pure, no Prisma, no JSX: both callers are clients, and the numbers it reads
// are already computed server-side by loadTravel/loadMap.
//
// A local hop is free full stop and never touches the header's count. A zone
// crossing while one is still available SPENDS one, which used to read as the
// identical word "free" and told a player nothing about the difference. "1
// travel" is what it actually costs — singular, because a single crossing is
// always exactly one no matter how many are left.

export function travelFoot(option, freeLeft, mounted) {
  if (!option.passable) {
    const reason = option.reason ?? "";
    if (/locked/i.test(reason)) return "locked";
    if (/shut/i.test(reason)) return "shut";
    return reason || "no way";
  }
  const cost = !option.crossesZone ? "free" : freeLeft > 0 ? "1 travel" : "the turn";
  // Only worth saying when there's something to lose — dismounts wins over
  // indoors when a way is both, since either one ends the same way and saying
  // it twice would be noise.
  if (option.dismounts) return `${cost} · on foot`;
  if (mounted && option.indoors) return `${cost} · indoors`;
  return cost;
}

// The sentence behind the trait chip on a way your own tag opens. The chip
// itself is just the tag's name — there is no room on a node for more — so this
// is what the hover and the screen reader get. Here rather than in either
// component for the same reason travelFoot is: /chat and /map both say it, and
// two copies would drift.
export function openedByLabel(tagName) {
  return `Opened by your ${tagName}.`;
}

// What to say about the destination itself, when it's worth a second look
// before Go. Returns null for an ordinary crossing — most of them.
//
// Depths gets its own line rather than sharing Caves' wording: it has no
// `safe` Location at all (CAVING.md §2a — Customs and the Depot, the only two,
// are both in Caves), and its loot column runs far hotter at the dangerous end
// (CAVING.md §3 — 25% rare / 7% extremely-rare / 3% nearly-impossible, against
// Caves' 1.95% / 0% / 0.05%), so "the Die is harsher here" is true, not just
// scarier-sounding.
function crossingWarning(option) {
  if (!option.caveLevel) return null;
  return option.zoneSlug === "depths"
    ? "The Caving Die rolls on every step down here, and nowhere in the Depths is safe from it."
    : "The Caving Die rolls on every step through the Caves — most of it is quiet, but not all of it.";
}

// The question asked before a zone crossing, on both surfaces.
//
// A crossing is the one move here that is expensive and cannot be taken back:
// it spends a travel or the whole Move, it drags whoever is with you along, and
// it lands at once. A hop inside a zone is none of those things and is never
// asked about. So this exists, and travelFoot's local "free" case has no
// counterpart below.
//
// Built here rather than in either component for the reason travelFoot is: two
// surfaces, one sentence. `freeLeft` is the DESTINATION's own count, not the
// header's ambient one — a boat's bonus is earned per crossing.
export function crossingConfirm(option, freeLeft, partySize = 0) {
  const price =
    (freeLeft ?? 0) > 0
      ? "This spends one of your travels."
      : "You have no travels left, so this spends your Move for the turn.";
  // Said out loud because it is the half of an accidental crossing that costs
  // somebody else their afternoon too.
  const party =
    partySize > 0
      ? partySize === 1
        ? " One person comes with you."
        : ` ${partySize} people come with you.`
      : "";
  const warning = crossingWarning(option);
  return {
    title: `${warning ? "⚠ " : ""}Cross into ${option.zoneName}?`,
    message: `${option.name} is in ${option.zoneName}. ${price}${party}`,
    warning,
    confirmLabel: "Go",
    cancelLabel: "Stay",
  };
}
