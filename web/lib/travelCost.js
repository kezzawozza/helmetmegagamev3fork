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

// Asked before a zone crossing on both surfaces; a hop inside a zone is never asked about. `freeLeft` is the DESTINATION's own count.
export function crossingConfirm(option, freeLeft, partySize = 0) {
  const price =
    (freeLeft ?? 0) > 0
      ? "This spends one of your travels."
      : "You have no travels left, so this spends your Move for the turn.";
  const party =
    partySize > 0
      ? partySize === 1
        ? " One person comes with you."
        : ` ${partySize} people come with you.`
      : "";
  return {
    title: `Cross into ${option.zoneName}?`,
    message: `${option.name} is in ${option.zoneName}. ${price}${party}`,
    confirmLabel: "Go",
    cancelLabel: "Stay",
  };
}
