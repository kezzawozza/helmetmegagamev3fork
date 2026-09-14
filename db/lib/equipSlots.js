// Which equipped things cannot be worn together, and how many hands there are.
//
// Every equippable tag names a Tag.equipSlot (db/lib/syncTags.js throws on one
// that doesn't), and the slot is the whole limit. GameConfig.equipSlots, the
// old flat count, is retired: it let a character ready eight swords and said
// nothing about two helmets, and the two rules disagreed about why an equip
// was refused.
//
//   HEAD, BODY          layered 1-3, MOUNT 1-2. Two equipped tags may not share
//                      a layer, so a coif (1) goes under a helm (2) and a cart
//                      (2) is towed behind a horse (1), but two helms do not go
//                      together.
//   WEAPON             four hands, and everything you hold goes here. A tag
//                      with Tag.twoHanded takes two. The old SHIELD slot was
//                      a second rule for the same place on the body — one
//                      cell called "Off hand" beside a row that counted hands
//                      — so it was folded in here and its enum value retired.
//                      Four is what the two slots already allowed together: a
//                      shield plus three hands of weapons.
//   ACCESSORY          four. A badge, spectacles, a fishing rod. Uncapped at
//                      first, which turned it into the pocket everything that
//                      fitted nowhere else went into.
//
// A STACKABLE tag takes one slot/hand PER EQUIPPED UNIT, not one for the whole
// stack — CharacterTag.equippedQuantity says how many of a held stack are
// actually out, and every function below expands a row into that many
// physical instances before it asks anything about slots, layers or hands.
// Five swords readied is three hands spent and two still in the pack, not one
// hand for "a stack of swords"; two units of the very same stackable layered
// tag (a hat, say) fight over their one layer exactly like two different hats
// would.
//
// Two independent code paths flip CharacterTag.equipped — the player's own
// toggle (web/app/(app)/character/equipActions.js) and the GM/staged batch
// (db/lib/tagOps.js) — so the rule lives here rather than in either of them. It
// is written as "look at the whole equipped set and find a problem" rather than
// "may I add this one?", because the batch path applies its writes first and
// then checks, and a two-argument form could not express "unequip A, equip B"
// without rejecting B for a conflict with an A that is already gone.
//
// See docs/systemdocs/TAGS.md.

const WEAPON_HANDS = 4;

// The fewest hand slots anybody can be reduced to, however much of them is
// missing. Two arms gone is 4 - 4 without this, and a character who can hold
// nothing at all is not a drawback — it is a dead end the game has nowhere to
// put. They cannot carry a torch, take a letter, or pick up the thing a scene
// is about. So the losses stack up to here and stop.
const HANDS_FLOOR = 2;

// How many hands a character actually has, after what they have lost
// (Tag.handsLost — a whole arm is 2, a hand that no longer grips is 1).
//
// Counted on tags HELD, not equipped, which is the opposite rule from armour
// and carry bonuses: nobody wears a missing arm. Accepts the CharacterTag
// shape used everywhere else and tolerates a bare Tag[], the same latitude
// db/lib/gambitModifier.js#holds takes.
//
// Ambidextrous deliberately does NOT give a slot back. It cancels the fighting
// penalty a maiming carries (docs/systemdocs/COMBAT.md), because "losing a
// hand would only be a minor inconvenience to you" is about coping — and
// coping is not the same as having the hand.
function handsFor(characterTags = []) {
  let lost = 0;
  for (const entry of characterTags ?? []) {
    const tag = entry?.tag ?? entry;
    const n = tag?.handsLost;
    if (typeof n === "number" && n > 0) lost += n;
  }
  return Math.max(HANDS_FLOOR, WEAPON_HANDS - lost);
}

// The Tag columns anything resolving a hand count must select, the discipline
// ARMOR_TAG_FIELDS sets. Miss it and every maimed character quietly reads as
// having four hands again.
const HANDS_TAG_FIELDS = { handsLost: true };
// A hard cap, not a GameConfig knob like the retired flat count: the number
// is a rule about what a person can have about them, and the last thing this
// file needs is a second limit a GM can set to disagree with the slots.
const MAX_ACCESSORIES = 4;
const LAYERED_SLOTS = new Set(["HEAD", "BODY", "MOUNT"]);
// SHIELD is deliberately absent: syncTags.js validates against this list, so
// a YAML entry still naming it throws instead of sliding through.
const EQUIP_SLOTS = ["HEAD", "BODY", "WEAPON", "ACCESSORY", "MOUNT"];

// The words the sheet and the refusals use for each slot. Player-facing copy.
const SLOT_LABELS = {
  HEAD: "on your head",
  BODY: "on your body",
  WEAPON: "in your hands",
  ACCESSORY: "about your person",
  MOUNT: "under you",
};

// The rig's row titles and the name of each layer cell, outermost last.
const SLOT_TITLES = {
  HEAD: "Head",
  BODY: "Body",
  WEAPON: "Held",
  ACCESSORY: "Accessories",
  MOUNT: "Ride",
};
const LAYER_NAMES = {
  HEAD: ["Liner", "Helm", "Outer"],
  BODY: ["Clothes", "Mail", "Outer"],
  MOUNT: ["Ridden", "Towed"],
};

// Accepts CharacterTag[] (with .tag) or bare Tag[], like forcedNameFrom.
function tagOf(entry) {
  return entry?.tag ?? entry;
}

// "A, B and C".
function listWords(names) {
  if (names.length <= 1) return names.join("");
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}

// One row per PHYSICAL unit, not one per CharacterTag row — a row carrying
// `equippedQuantity: 3` has to appear three times to anything that counts
// hands or looks for two things sharing a slot. `equippedQuantity` missing
// entirely (a bare Tag[], or a caller that never selected it) counts as
// exactly one, the same "holds it or doesn't" shape every other equipped
// check in the codebase already assumes.
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

/**
 * Hands in use across a set of equipped rows.
 * @param {Array} tags equipped rows — CharacterTag[] (with .tag, optionally
 *   .equippedQuantity) or Tag[]
 */
function handsUsed(tags) {
  return expandUnits(tags).reduce((n, tag) => n + handsOf(tag), 0);
}

/**
 * The first pair of equipped units that cannot be worn together. Expands by
 * equippedQuantity first, so a stack equipped twice clashes with itself.
 * @param {Array} tags equipped rows — CharacterTag[] (with .tag) or Tag[]
 * @returns {{a: object, b: object}|null} the clashing pair, outermost first
 */
function findSlotClash(tags) {
  const seen = new Map();
  for (const tag of expandUnits(tags)) {
    if (!tag?.equipSlot) continue;
    // WEAPON is counted in hands and ACCESSORY is never counted at all.
    if (tag.equipSlot === "WEAPON" || tag.equipSlot === "ACCESSORY") continue;
    // A layered slot keys on slot+layer. Nothing unlayered reaches here any
    // more — SHIELD was the last one, and keying on the slot alone is what
    // used to hold it to exactly one.
    const key = tag.equipLayer == null ? tag.equipSlot : `${tag.equipSlot}:${tag.equipLayer}`;
    const other = seen.get(key);
    if (other) return { a: tag, b: other };
    seen.set(key, tag);
  }
  return null;
}

/**
 * Why that pair cannot be worn together, as a sentence for a player.
 */
function describeSlotClash({ a, b }) {
  const where = SLOT_LABELS[a.equipSlot] ?? "there";
  // The same tag twice is a stackable slotted item (a hat, say) equipped past
  // its own single slot — TAGS.md §"equipSlot"/"equipLayer" still holds one
  // physical thing per slot however many units the stack carries.
  if (a.name === b.name) return `You can only have one ${a.name} ${where} at a time.`;
  return `${a.name} and ${b.name} can't both go ${where}.`;
}

/**
 * Why the readied weapons do not fit in the hands, or null when they do.
 *
 * Names only the EXCESS. A character carrying five weapons from before the
 * rule needs to know which ones to put down, and a refusal that listed the
 * whole armful — the ones already fitting included — told them nothing they
 * could act on. Hands are filled in the order the rows came, and anything
 * that will not go in is what has to go. Expands by equippedQuantity, so
 * three swords from one stack fill three hands, not one.
 */
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
  // A two-hander says so inline, and a repeated name collapses to a count, so
  // the sentence stays one sentence for a whole stack of excess swords too.
  const counts = new Map();
  for (const tag of excess) {
    const label = tag.twoHanded ? `${tag.name} (two hands)` : tag.name;
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  const named = listWords([...counts].map(([label, n]) => (n > 1 ? `${label} ×${n}` : label)));
  return `Your hands are full: put away ${named} before you equip something else.`;
}

/**
 * Where a tag goes and what it costs to put there, as a short label for a
 * buying menu or a chip. Null for anything that isn't equippable.
 *
 * Terse on purpose — it sits in a `<dl>` of one-line answers beside Weight and
 * Armour, and the sentence a refusal needs is describeSlotClash's job. What it
 * exists to say is the thing a shopper cannot otherwise work out: that a coif
 * and a helm stack because they sit at different layers, that a poleaxe eats
 * two of four hands, and that trinkets run out at four.
 */
function describeEquipFit(tag) {
  const slot = tag?.equipSlot;
  if (!slot) return null;
  if (slot === "WEAPON") return `${SLOT_TITLES.WEAPON} · takes ${tag.twoHanded ? "two" : "one"}`;
  if (slot === "ACCESSORY") return `${SLOT_TITLES.ACCESSORY} · ${MAX_ACCESSORIES} at once`;
  const layer = LAYER_NAMES[slot]?.[(tag.equipLayer ?? 0) - 1];
  return layer ? `${SLOT_TITLES[slot]} · ${layer}` : SLOT_TITLES[slot] ?? null;
}

/**
 * Why the accessories do not all fit, or null when they do.
 *
 * Names only the EXCESS, the same way describeHandsOverflow does and for the
 * same reason — a character wearing six trinkets from before the cap needs to
 * know which two to take off, not to be read their own inventory back.
 * Expands by equippedQuantity like everything else here, so five badges out
 * of one stack are five things about you, not one.
 */
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

/**
 * The one question both write paths ask after writing: is this set wearable?
 * @returns {string|null} a player-facing refusal, or null when the set is fine
 */
function findEquipProblem(tags, hands = WEAPON_HANDS) {
  const clash = findSlotClash(tags);
  if (clash) return describeSlotClash(clash);
  return describeHandsOverflow(tags, hands) ?? describeAccessoryOverflow(tags);
}

/**
 * What has to come off, for an INVOLUNTARY change that shrank the hands.
 *
 * A GM granting Missing Arm is the case this exists for. The gate above is
 * right for a player reaching for a fifth weapon — refuse, and say which ones
 * to put down — but wrong for a maiming: refusing to cut somebody's arm off
 * because their hands are full is the tail wagging the dog. So an involuntary
 * change sheds instead, the way db/lib/carry.js#settleCarry already sets down
 * whatever will not fit when a payout lands.
 *
 * Returns the rows to unequip, fullest hands first, until what is left fits.
 * Two-handers go before one-handers at equal cost, because putting down one
 * poleaxe beats putting down two knives.
 */
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
  findEquipProblem,
};
