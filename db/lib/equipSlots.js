// Which equipped things cannot be worn together, and how many hands there are. Every equippable tag names a Tag.equipSlot (db/lib/syncTags.js throws on one that doesn't), and the slot is the whole limit. HEAD is ONE thing, unlayered — a mask, a helm or a hood, never two of them; BODY is layered 1-2 (Mail next to the skin, Over on top, so a breastplate goes over a robe but two robes don't go together) and MOUNT 1-2 (a cart (2) is towed behind a horse (1)); WEAPON is four hands, everything held goes here, a Tag.twoHanded tag takes two (SHIELD is folded in here and its enum value retired — four is what the two slots already allowed together: a shield plus three hands of weapons); ACCESSORY is four (a badge, spectacles, a fishing rod).
// HEAD and BODY were each three layers until this. Head stacking (a mask under a helm under a hood) was the elaborate half and bought nothing a single slot does not: the fiction of a coif under a helmet is not worth a player having to reason about three head slots, and concealment now has exactly one source rather than an ordering puzzle. Body kept two because "armour over clothes" is a real choice a player makes and a real thing the armour maths adds up.
// A STACKABLE tag takes one slot/hand PER EQUIPPED UNIT, not one for the whole stack — CharacterTag.equippedQuantity says how many of a held stack are actually out, and every function below expands a row into that many physical instances before asking about slots, layers or hands (five swords readied is three hands spent, two still in the pack; two units of the same stackable layered tag fight over their one layer like two different hats would). Two independent code paths flip CharacterTag.equipped — the player's own toggle (web/app/(app)/character/equipActions.js) and the GM/staged batch (db/lib/tagOps.js) — so the rule lives here, written as "look at the whole equipped set and find a problem" rather than "may I add this one?", because the batch path applies its writes first and a two-argument form couldn't express "unequip A, equip B" without rejecting B for a conflict with an A already gone. See docs/systemdocs/TAGS.md.

const WEAPON_HANDS = 4;

// The fewest hand slots anybody can be reduced to, however much is missing. Without this, two arms gone is 4 - 4, and a character who can hold nothing at all isn't a drawback, it's a dead end the game has nowhere to put — they couldn't carry a torch, take a letter, or pick up the thing a scene is about. So losses stack up to here and stop.
const HANDS_FLOOR = 2;

// How many hands a character actually has, after what they've lost (Tag.handsLost — a whole arm is 2, a hand that no longer grips is 1). Counted on tags HELD, not equipped, the opposite rule from armour/carry bonuses — nobody wears a missing arm. Accepts the CharacterTag shape used everywhere else and tolerates a bare Tag[], the same latitude db/lib/gambitModifier.js#holds takes.
// Ambidextrous deliberately does NOT give a slot back — it cancels the fighting penalty a maiming carries (docs/systemdocs/COMBAT.md), because "losing a hand would only be a minor inconvenience to you" is about coping, not the same as having the hand.
function handsFor(characterTags = []) {
  let lost = 0;
  for (const entry of characterTags ?? []) {
    const tag = entry?.tag ?? entry;
    const n = tag?.handsLost;
    if (typeof n === "number" && n > 0) lost += n;
  }
  return Math.max(HANDS_FLOOR, WEAPON_HANDS - lost);
}

// The Tag columns anything resolving a hand count must select, the discipline ARMOR_TAG_FIELDS sets. Miss it and every maimed character quietly reads as having four hands again.
const HANDS_TAG_FIELDS = { handsLost: true };
// A hard cap, not a GameConfig knob like the retired flat count: the number is a rule about what a person can have about them, and the last thing this file needs is a second limit a GM can set to disagree with the slots.
const MAX_ACCESSORIES = 4;
// HEAD is deliberately NOT here: one head, one thing on it. An unlayered slot
// keys on the bare slot in findSlotClash below, which is the whole rule.
const LAYERED_SLOTS = new Set(["BODY", "MOUNT"]);
// SHIELD is deliberately absent: syncTags.js validates against this list, so a YAML entry still naming it throws instead of sliding through.
const EQUIP_SLOTS = ["HEAD", "BODY", "WEAPON", "ACCESSORY", "MOUNT"];

const SLOT_LABELS = {
  HEAD: "on your head",
  BODY: "on your body",
  WEAPON: "in your hands",
  ACCESSORY: "about your person",
  MOUNT: "under you",
};

const SLOT_TITLES = {
  HEAD: "Head",
  BODY: "Body",
  WEAPON: "Held",
  ACCESSORY: "Accessories",
  MOUNT: "Ride",
};
// The layer names, in order, for each layered slot. The ARRAY LENGTH is the
// layer cap — db/lib/syncTags.js validates docs/tags.yaml against it, so
// shortening one here makes a stale YAML entry fail the sync loudly rather
// than slide through as a layer nothing can wear.
const LAYER_NAMES = {
  BODY: ["Mail", "Over"],
  MOUNT: ["Ridden", "Towed"],
};

function tagOf(entry) {
  return entry?.tag ?? entry;
}

function listWords(names) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// One row per PHYSICAL unit, not one per CharacterTag row — a row carrying `equippedQuantity: 3` has to appear three times to anything that counts hands or looks for two things sharing a slot. `equippedQuantity` missing entirely (a bare Tag[], or a caller that never selected it) counts as exactly one, the same "holds it or doesn't" shape every other equipped check in the codebase already assumes.
function expandUnits(tags) {
  if (!Array.isArray(tags)) return [];
  return tags.flatMap((entry) => {
    const tag = tagOf(entry);
    const n = entry?.equippedQuantity ?? 1;
    return Array.from({ length: Math.max(0, n) }, () => tag);
  });
}

function handsOf(tag) {
  return tag?.equipSlot === "WEAPON" ? (tag.twoHanded ? 2 : 1) : 0;
}

function handsUsed(tags) {
  return expandUnits(tags).reduce((n, tag) => n + handsOf(tag), 0);
}

// The first pair of equipped units that cannot be worn together. Expands by equippedQuantity first, so a stack equipped twice clashes with itself. Returns the clashing pair { a, b } (outermost first) or null.
function findSlotClash(tags) {
  const seen = new Map();
  for (const tag of expandUnits(tags)) {
    if (!tag?.equipSlot) continue;
    // WEAPON is counted in hands and ACCESSORY is never counted at all. A layered slot keys on slot+layer; nothing unlayered reaches here any more — SHIELD was the last one.
    if (tag.equipSlot === "WEAPON" || tag.equipSlot === "ACCESSORY") continue;
    // An unlayered slot (HEAD) keys on the slot alone, so two of anything in
    // it clash. A layered one keys on slot+layer.
    const key = tag.equipLayer == null ? tag.equipSlot : `${tag.equipSlot}:${tag.equipLayer}`;
    const other = seen.get(key);
    if (other) return { a: tag, b: other };
    seen.set(key, tag);
  }
  return null;
}

function describeSlotClash({ a, b }) {
  const where = SLOT_LABELS[a.equipSlot] ?? "there";
  // The same tag twice is a stackable slotted item (a hat, say) equipped past its own single slot — TAGS.md §"equipSlot"/"equipLayer" still holds one physical thing per slot however many units the stack carries.
  if (a.name === b.name) return `You can only have one ${a.name} ${where} at a time.`;
  return `${a.name} and ${b.name} can't both go ${where}.`;
}

// Why the readied weapons don't fit in the hands, or null when they do. Names only the EXCESS: a character carrying five weapons from before the rule needs to know which ones to put down, not to be told the whole armful. Hands are filled in the order the rows came, and anything that won't go in is what has to go. Expands by equippedQuantity, so three swords from one stack fill three hands, not one.
function describeHandsOverflow(tags, hands = WEAPON_HANDS) {
  const units = expandUnits(tags);
  if (units.reduce((n, tag) => n + handsOf(tag), 0) <= hands) return null;
  const excess = [];
  let held = 0;
  for (const tag of units) {
    if (tag?.equipSlot !== "WEAPON") continue;
    const n = handsOf(tag);
    if (held + n <= hands) {
      held += n;
      continue;
    }
    excess.push(tag);
  }
  // A two-hander says so inline, and a repeated name collapses to a count, so the sentence stays one sentence for a whole stack of excess swords too.
  const counts = new Map();
  for (const tag of excess) {
    const label = tag.twoHanded ? `${tag.name} (two hands)` : tag.name;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const named = listWords([...counts].map(([label, n]) => (n > 1 ? `${label} ×${n}` : label)));
  return `Your hands are full: put away ${named} before you equip something else.`;
}

// Where a tag goes and what it costs to put there, as a short label for a buying menu or a chip. Null for anything that isn't equippable. Terse on purpose — it sits in a `<dl>` of one-line answers beside Weight and Armour; describeSlotClash's job is the full sentence. Says the thing a shopper can't otherwise work out: that a breastplate and a robe stack because one is Over and the other Mail, that a poleaxe eats two of four hands, that trinkets run out at four.
function describeEquipFit(tag) {
  const slot = tag?.equipSlot;
  if (!slot) return null;
  if (slot === "WEAPON") return `${SLOT_TITLES.WEAPON} · takes ${tag.twoHanded ? "two" : "one"}`;
  if (slot === "ACCESSORY") return `${SLOT_TITLES.ACCESSORY} · ${MAX_ACCESSORIES} at once`;
  const layer = LAYER_NAMES[slot]?.[(tag.equipLayer ?? 0) - 1];
  return layer ? `${SLOT_TITLES[slot]} · ${layer}` : SLOT_TITLES[slot] ?? null;
}

// Why the accessories don't all fit, or null when they do. Names only the EXCESS, same reason as describeHandsOverflow — a character wearing six trinkets from before the cap needs to know which two to take off, not to be read their own inventory back. Expands by equippedQuantity like everything else here, so five badges out of one stack are five things about you, not one.
function describeAccessoryOverflow(tags) {
  const worn = expandUnits(tags).filter((t) => t?.equipSlot === "ACCESSORY");
  if (worn.length <= MAX_ACCESSORIES) return null;
  const counts = new Map();
  for (const tag of worn.slice(MAX_ACCESSORIES)) {
    counts.set(tag.name, (counts.get(tag.name) ?? 0) + 1);
  }
  const named = listWords([...counts].map(([name, n]) => (n > 1 ? `${name} ×${n}` : name)));
  return `You can equip ${MAX_ACCESSORIES} at a time: put away ${named}.`;
}

function findEquipProblem(tags, hands = WEAPON_HANDS) {
  const clash = findSlotClash(tags);
  if (clash) return describeSlotClash(clash);
  return describeHandsOverflow(tags, hands) ?? describeAccessoryOverflow(tags);
}

// What has to come off, for an INVOLUNTARY change that shrank the hands. A GM granting Missing Arm is the case this exists for: the gate above is right for a player reaching for a fifth weapon (refuse, say which to put down), but wrong for a maiming — refusing to cut somebody's arm off because their hands are full is the tail wagging the dog. So an involuntary change sheds instead, the way db/lib/carry.js#settleCarry already sets down whatever won't fit when a payout lands.
// Returns the rows to unequip, fullest hands first, until what's left fits. Two-handers go before one-handers at equal cost, since putting down one poleaxe beats putting down two knives.
function shedForHands(worn, hands) {
  const rows = (worn ?? []).filter((r) => (r?.tag ?? r)?.equipSlot === "WEAPON");
  let held = rows.reduce((n, r) => n + handsOf(r?.tag ?? r) * Math.max(1, r?.equippedQuantity ?? 1), 0);
  if (held <= hands) return [];
  const shed = [];
  for (const row of [...rows].sort((a, b) => handsOf((b?.tag ?? b)) - handsOf((a?.tag ?? a)))) {
    if (held <= hands) break;
    const tag = row?.tag ?? row;
    held -= handsOf(tag) * Math.max(1, row?.equippedQuantity ?? 1);
    shed.push(row);
  }
  return shed;
}

module.exports = {
  WEAPON_HANDS,
  HANDS_FLOOR,
  HANDS_TAG_FIELDS,
  handsFor,
  shedForHands,
  MAX_ACCESSORIES,
  LAYERED_SLOTS,
  EQUIP_SLOTS,
  SLOT_TITLES,
  LAYER_NAMES,
  handsOf,
  handsUsed,
  describeEquipFit,
  findSlotClash,
  findEquipProblem,
};
