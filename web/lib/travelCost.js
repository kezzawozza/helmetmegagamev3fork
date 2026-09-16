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
//
// `moved` is whether the Move is already spent this turn. Past that point a
// crossing with no travel left is paid on the push on's die (MAP.md §3) —
// "exertion" — or not at all until next turn, when the server would refuse the
// push on too (`option.canExert`).
export function travelFoot(option, freeLeft, mounted, moved = false) {
  if (!option.passable) {
    const reason = option.reason ?? "";
    if (/locked/i.test(reason)) return "locked";
    if (/shut/i.test(reason)) return "shut";
    return reason || "no way";
  }
  const cost = !option.crossesZone
    ? "free"
    : freeLeft > 0
      ? "1 travel"
      : !moved
        ? "the turn"
        : option.canExert
          ? "exertion"
          : "next turn";
  // Only worth saying when there's something to lose — dismounts wins over
  // indoors when a way is both, since either one ends the same way and saying
  // it twice would be noise.
  if (option.dismounts) return `${cost} · on foot`;
  if (mounted && option.indoors) return `${cost} · indoors`;
  return cost;
}

// The line over the buttons once a destination is picked, on both surfaces.
// `nextTurn` is the caller's "this crossing has no travel left" (a
// destination's OWN count, not the header's); `moved` whether the Move is
// already spent. Once it is, Go is gone and the push on is the only way
// across — or none this turn, and `option.exertWhy` is the server's reason.
export function crossingLine(option, nextTurn, moved) {
  if (!nextTurn) return `To ${option.name}.`;
  if (!moved) return `To ${option.name}. This one spends your Move.`;
  if (option.canExert) return `To ${option.name}. Your Move is spent, so this one costs exertion.`;
  return `To ${option.name}. Your Move is spent.${option.exertWhy ? ` ${option.exertWhy}` : ""}`;
}

// The sentence behind the trait chip on a way your own tag opens. The chip
// itself is just the tag's name — there is no room on a node for more — so this
// is what the hover and the screen reader get. Here rather than in either
// component for the same reason travelFoot is: /chat and /map both say it, and
// two copies would drift.
export function openedByLabel(tagName) {
  return `Opened by your ${tagName}.`;
}

// Second-look warning before Go, null otherwise — CAVING.md §2a's Customs/Depot exemption is already in `caveLevel`.
function crossingWarning(option) {
  if (!option.caveLevel) return null;
  return "You will roll Caving Die every time you move through here.";
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
//
// `exert` is the other question, asked from the other button: pushing on for
// one more crossing on a die instead of the Move (MAP.md §3). `option.exertNote`
// is the server's sentence about which way the die leans, when it does
// (db/lib/locationTravel.js#exertEdgeSentence), so the two faces say it the
// same way.
export function crossingConfirm(option, freeLeft, partySize = 0, { exert = false } = {}) {
  // Said out loud because it is the half of an accidental crossing that costs
  // somebody else their afternoon too.
  const party =
    partySize > 0
      ? partySize === 1
        ? " One person comes with you."
        : ` ${partySize} people come with you.`
      : "";
  if (exert) {
    const note = option.exertNote ? ` ${option.exertNote}` : "";
    return {
      title: `Push on to ${option.zoneName}?`,
      message: `${option.name} is in ${option.zoneName} and you have no free travels left. You can choose to push yourself, risking exhaustion and possible injury.${note}${party}`,
      confirmLabel: "Push on",
      cancelLabel: "Stay",
    };
  }
  const price =
    (freeLeft ?? 0) > 0
      ? "This spends one of your travels."
      : "You have no travels left, so this spends your Move for the turn.";
  return {
    title: `Cross into ${option.zoneName}?`,
    message: `${option.name} is in ${option.zoneName}. ${price}${party}`,
    confirmLabel: "Go",
    cancelLabel: "Stay",
  };
}

// "A", "A and B", "A, B and C" — for naming the stops on a walk.
function listOf(names) {
  if (names.length <= 1) return names[0] ?? "";
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// What a WALK costs, in the words both surfaces print (MAP.md §3c). A walk is
// inside your own zone and spends nothing at all — no travel, no Move — so the
// only things worth saying are how far it is and whether the road is too narrow
// for what you are riding. Here rather than in either component for the reason
// travelFoot is here: /chat and /map both say it, and two copies would drift.
export function walkFoot(route, mounted) {
  const far = route.hops === 1 ? "1 hop" : `${route.hops} hops`;
  // Same precedence travelFoot uses — a dismount is the one consequence worth
  // the space, and saying "indoors" beside it would be the same news twice.
  if (route.dismounts) return `${far} · on foot`;
  if (mounted && route.indoors) return `${far} · indoors`;
  return far;
}

// The line over Go once a walk is picked, and it NAMES THE STOPS.
//
// That is not decoration. The map moves on a double-click again (MAP.md §6c),
// and the thing that makes a gesture safe — beyond it never crossing a zone —
// is that the places you are about to walk through are on the screen before you
// make it. If this sentence ever gets cut for space, the gesture should be cut
// with it.
export function walkLine(route) {
  const through = route.through ?? [];
  if (through.length === 0) return `To ${route.name}.`;
  return `To ${route.name}, through ${listOf(through)}.`;
}

// The hint under the strip, on a mouse only. A walk is the only thing the
// gesture may do, so this is only ever drawn beside one.
export const WALK_HINT = "Double-click the place, or press Enter.";
