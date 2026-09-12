// What a status tag takes away from you.
//
// This used to be one flat Set called INCAPACITATING_SLUGS, and that set was
// the only answer the game had to "can this character do this?". It worked
// for the physical half — a bound man does not swing a hammer — but it had
// nothing to say about the other half, so a Paralyzed character could shout
// across a Location and a Mute one could talk all day. {tag:mute} cost −7
// points and did not appear in a single line of code.
//
// So the set became a table. Each slug names the capabilities it removes, and
// everything else is derived from it, which is the point: the old set and a
// speech gate maintained separately would have drifted within a month.
//
// Three capabilities, because three is what the game actually distinguishes:
//
//   ACT    the physical half — equip, craft, destroy, labor, butcher, trade,
//          extract, teach, confess. "Can't act" must stay literally true of
//          every slug that blocks it, because db/lib/autoLaborPass.js skips
//          filing an auto-Labor for them.
//   SPEAK  the voice half — the proxy (ordinary chat, whispers, the Speak
//          modal), a Bird reply.
//   SHOUT  the loud half — /shout, and anything else built to carry: the
//          Council Room intercom, which is a loudspeaker rather than a
//          conversation. Split off SPEAK because {tag:mute} is the one state
//          that takes the carrying voice without taking the ordinary one.
//          SPEAK IMPLIES SHOUT: a slug that removes your voice removes your
//          yell too, so no entry ever lists both, and expandCaps() below is
//          what keeps the two from drifting apart.
//
// Deliberately NOT capabilities: seeing and hearing. Vision already has two
// homes that predate this file (db/lib/examineVision.js,
// db/lib/inspectVision.js) and answers a different question — what a surface
// will show you, not what you may do. Hearing cannot be modelled at all: a
// shout and the intercom are posted into shared Discord channels, and there
// is no way to hide a channel message from one member of it, so not hearing
// is roleplay, as it always has been.
const ACT = "ACT";
const SPEAK = "SPEAK";
const SHOUT = "SHOUT";
// KISS is the fourth, and the narrowest: it gates one verb
// (docs/systemdocs/KISS.md). It is separate from ACT rather than folded into
// it because the two disagree in both directions — {tag:mute} acts and kisses
// fine, and {tag:broken-jaw} acts fine with its mouth wired shut.
const KISS = "KISS";

// Two implications, written once here rather than by listing the second half
// beside every first half in the table, because that second half is exactly
// the thing somebody forgets.
//
//   SPEAK implies SHOUT   a slug that takes your voice takes your yell too.
//   ACT   implies KISS    every state that leaves you unable to act — bound,
//                         dying, unconscious, crucified — is also a state
//                         nobody can kiss you in. This is what makes the
//                         "a kiss needs somebody who can answer" rule fall
//                         out of the table instead of being a second list.
function expandCaps(caps) {
  const out = caps.includes(SPEAK) ? [...caps, SHOUT] : [...caps];
  if (caps.includes(ACT) && !out.includes(KISS)) out.push(KISS);
  return out;
}

// The table. A slug absent from here takes nothing away.
//
//   bound        can't act, CAN shout — but the shout no longer carries past
//                the place you are standing in, and says so ("but it's
//                muffled"). That MUFFLE lives in db/lib/say.js#loadVoiceState
//                as shoutMuffled, not in this table, because the table is
//                about what is refused and a muffle refuses nothing. The
//                people beside you still hear you; nobody a street away does.
//   dying        can't act, CAN speak. Last words are the tradition.
//   catatonic-afk  can't act, CAN speak — and this one is not a taste call.
//                db/lib/catatonicPass.js DMs the player "it lifts the moment
//                you act or speak in character again", and lifts it off the
//                back of their activity clock. Gate their speech and they can
//                never clear it, and db/lib/catatonicDeathPass.js then kills
//                them for it. Catatonic must never block SPEAK.
//   paralyzed    can't act, CAN speak, cannot shout. It used to take SPEAK
//                too, on the strength of a description that has promised
//                "You can't move or talk" since the day it was written — but
//                that stranded a player dropped into a private Conversation
//                with no way to even say OOC that they were out. Same failure
//                {tag:mute} already made once (see below): silencing the
//                character silenced the person playing them.
//   seizure      can't act, CAN speak, cannot shout. You are on the floor
//                (docs/systemdocs/FACTORY.md); same reasoning as paralyzed.
//   unconscious  can't act, CAN speak, cannot shout. The top of the drinking
//                ladder (BREWING.md); same reasoning as paralyzed.
//   crucified    can't act, CAN speak — nailed up in the Square is the one
//                place last words are the whole show. Put on by the Crucify
//                button; becomes Dying after a turn (docs/tags.yaml).
//   mute         shouting only. Acts normally — a mute smith is still a smith —
//                and talks normally too: it went from blocking every word a
//                character said to blocking only the ones they have to bellow.
//                Bought speechlessness turned out to be a tag that removed the
//                player from the game rather than the character from a
//                conversation, so it is no longer purchasable either
//                (docs/tags.yaml); the tongue rung of the Mutilate ladder
//                (db/lib/mutilate.js) is what puts it on somebody now.
//
// SPEAK is deliberately empty now — nothing in this table takes it. Adding a
// slug back to that column is a conscious act, not a place to default to; see
// paralyzed/seizure/unconscious above for why the last three were pulled out
// of it. (`db/test/incapacitation.test.js` asserts the column stays empty.)
const RESTRICTIONS = {
  dying: [ACT],
  "catatonic-afk": [ACT],
  bound: [ACT],
  crucified: [ACT],
  seizure: [ACT, SHOUT],
  paralyzed: [ACT, SHOUT],
  unconscious: [ACT, SHOUT],
  mute: [SHOUT],

  // KISS only. Everything above already blocks it through ACT (see
  // expandCaps); these are the states that leave a character walking and
  // working and still in no condition to kiss anybody. Three groups:
  //
  //   nobody home    asleep, blind-drunk, hallucinating, madness, sepsis,
  //                  pain-shock, stupid — the consent is not there to give.
  //                  {tag:madness} also compels an attack on whoever is
  //                  standing nearby, which settles it twice over.
  //   the mouth      broken-jaw, wired-jaw, choking, vomiting. The injury IS
  //                  the mouth; {tag:wired-jaw} is literally wired shut.
  //   nothing left   gibbed, exploded-chest. Both are unrecoverable, and both
  //                  can sit on a row the engine has not finished with.
  //
  // Illness is deliberately absent. Leper, Pox, Consumptive and the rest all
  // kiss freely — Bascinet's call, and the same posture TAGS.md §5f takes
  // about what is NOT gated ("somebody can always pour a drink into you").
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

// A living character who can't defend themselves or walk away — the target
// class for LOOT_CHARACTER, HARM_CHARACTER and the "or helpless" branch of
// escorting, which takes them along without asking
// (db/lib/escort.js, REQUESTS.md, TAGS.md §5c). Slugs here must exist in
// docs/tags.yaml. Catatonic carries a death countdown
// (GameConfig.catatonicDeathTurns, db/lib/catatonicDeathPass.js) and also
// covers players who left the guild (db/lib/playerDeparture.js).
//
// DERIVED from the ACT column rather than written out again: helpless is
// exactly "cannot act", and two hand-maintained lists would disagree the
// first time somebody added a tag to one of them. {tag:mute} is the proof
// this is the right derivation — it is the one entry in the table that keeps
// its hands, and it correctly does not appear here.
const INCAPACITATING_SLUGS = new Set(
  Object.entries(RESTRICTIONS)
    .filter(([, caps]) => caps.includes(ACT))
    .map(([slug]) => slug),
);

// The narrower set HARM_CHARACTER's lethal half uses: that half kills
// outright with no GM confirmation (REQUESTS.md §5b), so this gate is the
// whole of what stands between a player and another player's character.
// Catatonic is deliberately excluded — it means AFK or departed, not
// helpless, and the engine kills those on its own clock
// (db/lib/catatonicDeathPass.js). A Catatonic body can still be dragged and
// robbed; INCAPACITATING_SLUGS above governs that.
//
// Hand-written, NOT derived: this is a shorter list on purpose, and every
// addition to it should cost somebody a deliberate keystroke. `seizure` is
// out because nobody asked for executing the man on the floor, and
// `unconscious` is out for the same reason — passing out in a tavern should
// not be a death sentence anyone can carry out without a GM.
const FINISHABLE_SLUGS = new Set(["dying", "bound"]);

// Accepts the CharacterTag[] shape used everywhere else (`{ tag: { slug } }`)
// and tolerates a bare Tag[], matching db/lib/examineVision.js#slugSet.
function slugSet(characterTags) {
  return new Set((characterTags ?? []).map((ct) => ct?.tag?.slug ?? ct?.slug).filter(Boolean));
}

// The one question every gate asks. Returns the OFFENDING TAG rather than a
// boolean, so the caller can name it — "You're Bound." beats "You can't do
// that.", and a player who cannot see why they were refused files a GM ticket
// about it.
//
// Returns { slug, name } or null. `name` falls back to the slug for a caller
// that loaded tags without one.
//
// No assertCan() wrapper on top: the two faces need different failures — a
// thrown UserError on the web, a respond() in the bot — and a helper that
// threw would be wrong for one of them.
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
