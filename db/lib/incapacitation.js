// What a status tag takes away from you. Each slug names the capabilities it removes; everything
// else derives from the table below, so the old flat INCAPACITATING_SLUGS set and a separate speech
// gate can't drift apart. ACT is the physical half — "can't act" must stay literally true of every
// slug that blocks it, because db/lib/autoLaborPass.js skips filing an auto-Labor for them. SPEAK is
// the proxy voice; SHOUT is /shout and the intercom. Not capabilities: seeing (db/lib/examineVision.js,
// db/lib/inspectVision.js — a different question) and hearing (unmodellable — Discord channels are shared).
const ACT = "ACT";
const SPEAK = "SPEAK";
const SHOUT = "SHOUT";
// KISS is the fourth and narrowest — gates one verb (docs/systemdocs/KISS.md), separate from ACT
// because the two disagree both ways ({tag:mute} kisses fine; {tag:broken-jaw} acts fine).
const KISS = "KISS";

// SPEAK implies SHOUT; ACT implies KISS (expandCaps below) — every state that leaves you unable to
// act is also a state nobody can kiss you in, so that rule falls out of the table instead of a second list.
function expandCaps(caps) {
  const out = caps.includes(SPEAK) ? [...caps, SHOUT] : [...caps];
  if (caps.includes(ACT) && !out.includes(KISS)) out.push(KISS);
  return out;
}

// The table. A slug absent from here takes nothing away. bound/dying/catatonic-afk/paralyzed/seizure/
// unconscious/crucified all keep SPEAK — catatonic-afk must never block it (db/lib/catatonicPass.js
// clears the state on speech; db/lib/catatonicDeathPass.js kills them otherwise), and a Speech-blocked
// player stranded in a private Conversation has no way to even say OOC they're out. bound keeps a
// muffled SHOUT (db/lib/say.js#loadVoiceState's shoutMuffled — a muffle refuses nothing, so it's not here).
// mute blocks only SHOUT (docs/tags.yaml; put on by the Mutilate tongue rung, db/lib/mutilate.js).
// SPEAK is deliberately empty — adding a slug to it is a conscious act (`db/test/incapacitation.test.js`
// asserts the column stays empty).
const RESTRICTIONS = {
  dying: [ACT],
  "catatonic-afk": [ACT],
  bound: [ACT],
  crucified: [ACT],
  seizure: [ACT, SHOUT],
  paralyzed: [ACT, SHOUT],
  unconscious: [ACT, SHOUT],
  mute: [SHOUT],

  // KISS only (everything above already blocks it via ACT — see expandCaps): states that leave a
  // character walking and working but in no condition to kiss anybody — no consent (asleep, blind-drunk,
  // hallucinating, madness, sepsis, pain-shock, stupid), the mouth itself (broken-jaw, wired-jaw, choking,
  // vomiting), or nothing left (gibbed, exploded-chest). Illness is deliberately absent — TAGS.md §5f.
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

// A living character who can't defend themselves or walk away — target class for LOOT_CHARACTER,
// HARM_CHARACTER and the "or helpless" escort branch (db/lib/escort.js, REQUESTS.md, TAGS.md §5c).
// Slugs here must exist in docs/tags.yaml. DERIVED from the ACT column, not hand-maintained.
const INCAPACITATING_SLUGS = new Set(
  Object.entries(RESTRICTIONS)
    .filter(([, caps]) => caps.includes(ACT))
    .map(([slug]) => slug),
);

// The narrower set HARM_CHARACTER's lethal half uses (kills outright, no GM confirmation — REQUESTS.md
// §5b). Catatonic is deliberately excluded (engine kills those on its own clock, db/lib/catatonicDeathPass.js).
// Hand-written, NOT derived, on purpose — `seizure`/`unconscious` are out so passing out isn't a death sentence.
const FINISHABLE_SLUGS = new Set(["dying", "bound"]);

// Accepts CharacterTag[] (`{ tag: { slug } }`) or a bare Tag[], matching db/lib/examineVision.js#slugSet.
function slugSet(characterTags) {
  return new Set((characterTags ?? []).map((ct) => ct?.tag?.slug ?? ct?.slug).filter(Boolean));
}

// Returns the OFFENDING TAG ({ slug, name }) rather than a boolean, so the caller can name it
// ("You're Bound."). No assertCan() wrapper — the web throws, the bot respond()s, differently.
function blockerFor(characterTags, capability) {
  const held = slugSet(characterTags);
  for (const [slug, caps] of Object.entries(RESTRICTIONS)) {
    if (!expandCaps(caps).includes(capability) || !held.has(slug)) continue;
    const match = (characterTags ?? []).find((ct) => (ct?.tag?.slug ?? ct?.slug) === slug);
    return { slug, name: match?.tag?.name ?? match?.name ?? slug };
  }
  return null;
}

// Every slug that blocks a capability — for the bot's message-proxy query,
// which has to name the tags it wants in a `where` rather than loading them
// all on the hottest path in the game.
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
  blockerFor,
  slugsBlocking,
};
