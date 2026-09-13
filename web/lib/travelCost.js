// Hop cost text, shared by the Travel panel and /map (not TravelNodes.js), pure. A local hop never touches the header's count.
export function travelFoot(option, freeLeft, mounted) {
  if (!option.passable) {
    const reason = option.reason ?? "";
    if (/locked/i.test(reason)) return "locked";
    if (/shut/i.test(reason)) return "shut";
    return reason || "no way";
  }
  const cost = !option.crossesZone ? "free" : freeLeft > 0 ? "1 travel" : "the turn";
  // dismounts wins over indoors when a way is both, to avoid saying it twice
  if (option.dismounts) return `${cost} · on foot`;
  if (mounted && option.indoors) return `${cost} · indoors`;
  return cost;
}

// Trait chip hover/reader text; shared by /chat and /map.
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
