// A slug's capabilities (table below) derive everything else, so INCAPACITATING_SLUGS and the speech
// gate can't drift apart. ACT must stay literally true — db/lib/autoLaborPass.js skips auto-Labor for
// slugs that block it. Not capabilities: seeing (db/lib/examineVision.js, db/lib/inspectVision.js) or
// hearing (unmodellable — Discord channels are shared).
const ACT = "ACT";
const SPEAK = "SPEAK";
const SHOUT = "SHOUT";
// KISS is the fourth, narrowest capability (docs/systemdocs/KISS.md), separate from ACT because the
// two can disagree both ways ({tag:mute} kisses fine; {tag:broken-jaw} acts fine).
const KISS = "KISS";

// SPEAK implies SHOUT; ACT implies KISS — every state that blocks acting also blocks kissing, so that
// falls out of the table below instead of a second list.
function expandCaps(caps) {
  const out = caps.includes(SPEAK) ? [...caps, SHOUT] : [...caps];
  if (caps.includes(ACT) && !out.includes(KISS)) out.push(KISS);
  return out;
}

// A slug absent from here takes nothing away. catatonic-afk must never block SPEAK (db/lib/catatonicPass.js
// clears it on speech; db/lib/catatonicDeathPass.js kills them otherwise) — a Speech-blocked player in a
// private Conversation has no way to say OOC they're out. bound keeps a muffled SHOUT (db/lib/say.js#
// loadVoiceState's shoutMuffled). mute blocks only SHOUT (docs/tags.yaml, put on by db/lib/mutilate.js).
// SPEAK stays deliberately empty — db/test/incapacitation.test.js asserts it.
const RESTRICTIONS = {
  dying: [ACT],
  "catatonic-afk": [ACT],
  bound: [ACT],
  crucified: [ACT],
  seizure: [ACT, SHOUT],
  paralyzed: [ACT, SHOUT],
  unconscious: [ACT, SHOUT],
  mute: [SHOUT],

  // KISS only (ACT states above already block it via expandCaps): no consent (asleep, blind-drunk,
  // hallucinating, madness, sepsis, pain-shock, stupid), the mouth itself (broken-jaw, wired-jaw,
  // choking, vomiting), or nothing left (gibbed, exploded-chest). Illness is absent — TAGS.md §5f.
  asleep: [KISS],
  "blind-drunk": [KISS],
  hallucinating: [KISS],
  madness: [KISS],
  sepsis: [KISS],
  "pain-shock": [KISS],
  stupid: [KISS],
  "disabled-shocked": [KISS],
  choking: [KISS],
  vomiting: [KISS],
  "broken-jaw": [KISS],
  "wired-jaw": [KISS],
  gibbed: [KISS],
  "exploded-chest": [KISS],
};

// A living character who can't defend themselves or flee — target class for LOOT_CHARACTER,
// HARM_CHARACTER and the "or helpless" escort branch (db/lib/escort.js, REQUESTS.md, TAGS.md §5c).
// Slugs must exist in docs/tags.yaml. Derived from the ACT column, not hand-maintained.
const INCAPACITATING_SLUGS = new Set(
  Object.entries(RESTRICTIONS)
    .filter(([, caps]) => caps.includes(ACT))
    .map(([slug]) => slug),
);

// HARM_CHARACTER's lethal half: kills outright, no GM confirmation (REQUESTS.md §5b). Catatonic is
// excluded (db/lib/catatonicDeathPass.js kills those on its own clock); hand-written, not derived, so
// seizure/unconscious don't become a death sentence.
const FINISHABLE_SLUGS = new Set(["dying", "bound"]);

// The narrower gate on a GAMBIT Move (db/lib/moves.js#fileMove): only being truly out of it stops a
// long shot. Bound, Crucified and Catatonic can still try something — Bascinet's ruling. Routine and
// Labor keep the full ACT gate; every other action does too.
const GAMBIT_BLOCKING_SLUGS = new Set(["unconscious", "paralyzed", "seizure", "dying"]);

// Accepts CharacterTag[] ({ tag: { slug } }) or a bare Tag[], matching db/lib/examineVision.js#slugSet.
function slugSet(characterTags) {
  return new Set((characterTags ?? []).map((ct) => ct?.tag?.slug ?? ct?.slug).filter(Boolean));
}

// Returns the offending tag ({ slug, name }), not a boolean, so the caller can name it ("You're
// Bound."). No assertCan() wrapper — the web throws, the bot respond()s, differently.
function blockerFor(characterTags, capability) {
  const held = slugSet(characterTags);
  for (const [slug, caps] of Object.entries(RESTRICTIONS)) {
    if (!expandCaps(caps).includes(capability) || !held.has(slug)) continue;
    const match = (characterTags ?? []).find((ct) => (ct?.tag?.slug ?? ct?.slug) === slug);
    return { slug, name: match?.tag?.name ?? match?.name ?? slug };
  }
  return null;
}

// blockerFor's shape, for a Gambit: { slug, name } of the first GAMBIT_BLOCKING_SLUGS tag held, or null.
function gambitBlockerFor(characterTags) {
  for (const ct of characterTags ?? []) {
    const slug = ct?.tag?.slug ?? ct?.slug;
    if (GAMBIT_BLOCKING_SLUGS.has(slug)) return { slug, name: ct?.tag?.name ?? ct?.name ?? slug };
  }
  return null;
}

// Every slug blocking a capability — for the bot's message-proxy query, which names tags in a
// `where` rather than loading them all on the hottest path in the game.
function slugsBlocking(capability) {
  return Object.entries(RESTRICTIONS)
    .filter(([, caps]) => expandCaps(caps).includes(capability))
    .map(([slug]) => slug);
}

module.exports = {
  ACT,
  SPEAK,
  SHOUT,
  KISS,
  RESTRICTIONS,
  INCAPACITATING_SLUGS,
  FINISHABLE_SLUGS,
  GAMBIT_BLOCKING_SLUGS,
  blockerFor,
  gambitBlockerFor,
  slugsBlocking,
};
