// Looking at whoever said one archived line — the Prisma half of
// db/lib/examine.js, which stays deliberately pure. The ONE path behind every
// look now (Discord 🔍/📸, the web feed eye, the HERE column, the camera),
// replacing four copies that used to agree by hand on the doctor's-eye and
// hood rules. Pressed against a SEQ, not a character id, so the
// server resolves the speaker itself and a page can offer a look at a hooded
// line without being told who's under it (avoiding db/lib/whosHere.js#hoodToken).
// AND IT ANSWERS FOR THE MOMENT THE LINE WAS SAID, not for now: a mask coming
// off never retroactively unmasks, gear picked up after never appears on an
// earlier line. The row froze what the room could see and this reads it back
// — db/lib/examineSnapshot.js holds the freeze rule, read before changing
// either side. A row with no snapshot (written before the column existed)
// falls back to the live character. `viewer` is a live Character loaded with
// VIEWER_SELECT below. Returns { blocked } when they can't see, null when the
// line/speaker is gone, { readout } otherwise.
const { EXAMINE_TAG_SELECT, EXAMINE_SUBJECT_SELECT, examineReadout, canSeeDesire } = require("./examine");
const { readPresentedState, rehydrateSubject } = require("./examineSnapshot");
const { buildSkillAncestry, satisfiedSkillIds } = require("./medicalVision");
const { examineBlock } = require("./examineVision");
const { isDaylight } = require("./turnClock");
const { forcedNameFrom, wasHooded } = require("./presentedIdentity");
const { feedWipeFloors, floorForPlace } = require("./feedWipe");
const { mayReadPlace } = require("./feedAccess");
const { THANATI_SLUG } = require("./thanati");

// `equipped` and the roof are for examineVision.js: spectacles only correct while worn, Sun
// Sensitivity only blinds outdoors.
const VIEWER_SELECT = {
  id: true,
  locationId: true,
  discordUserId: true,
  tags: { select: { tagId: true, equipped: true, tag: { select: { slug: true } } } },
  location: { select: { indoors: true } },
};

// `bystander: true` strips the viewer's own sight — no doctor's eye, no
// Seductive — what a CAMERA sees, closing the one way the doctor's-eye gate could be laundered.
//
// `ghost` is a dead player (db/lib/ghost.js), looking at a line from a place their seat lets them
// read. They keep their old character's learned sight — a doctor who died still knows what a wound
// looks like — but the vision BLOCKS are skipped below: a blindfold, spectacles left behind and the
// dark are all things that happen to a body, and theirs is on the floor.
async function examineRow(prisma, viewer, seq, { bystander = false, gm = false, ghost = false } = {}) {
  if (!viewer?.id || seq === null || seq === undefined) return null;

  let key;
  try {
    key = BigInt(seq);
  } catch {
    return null;
  }

  const row = await prisma.archiveEntry.findUnique({
    where: { seq: key },
    // presentedAvatarPath is the face the room actually saw (for wasHooded below), the only signal
    // telling a hood from a forced name once the forcing tag has worn off.
    select: {
      kind: true,
      seq: true,
      turnNumber: true,
      characterId: true,
      concealedAlias: true,
      presentedAvatarPath: true,
      presentedState: true,
      deletedAt: true,
      placeKey: true,
    },
  });
  if (!row || row.deletedAt || !row.characterId || !row.placeKey) return null;
  // A system event (a death, a fulfilled Desire) is not a thing anybody watched somebody say.
  if (row.kind !== "MESSAGE") return null;
  if (row.characterId === viewer.id) return null;

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } });

  // Blindness first — nothing else can rescue it.
  const blocked = examineBlock(viewer.tags ?? [], {
    daylight: isDaylight(),
    indoors: viewer.location?.indoors ?? true,
  });
  if (blocked && !ghost) return { blocked };

  // Earshot is the gate, not co-presence: a seq is guessable, so this stops a
  // line being looked at from outside the room — the same check starRow/photographRow make.
  const allowed = await mayReadPlace(prisma, viewer, row.placeKey, { gm, ghost, discordUserId: viewer.discordUserId });
  if (!allowed) return null;

  // Same FLOOR the feed renders above (feedWipe.js), so a look reaches exactly
  // as far as Chat and no further — without it a radio net (no location
  // component) would carry its whole history to anyone who could hear it now.
  const floors = await feedWipeFloors(prisma);
  if (row.seq <= floorForPlace(floors, row.placeKey)) return null;

  // Null for a row written before the column — everything below falls back to the live character.
  const state = readPresentedState(row.presentedState);

  // rehydrateSubject overwrites every in-fiction field, so loading the whole
  // subject would fetch a tag join to throw away. Left: id, avatar cache-buster, age, gender.
  const live = await prisma.character.findUnique({
    where: { id: row.characterId },
    select: state
      ? { id: true, name: true, age: true, gender: true, updatedAt: true }
      : EXAMINE_SUBJECT_SELECT,
  });
  if (!live) return null;

  // The tag CATALOG — rules, not disguise: a rebalance should reach an old line.
  const catalog = state
    ? await prisma.tag.findMany({
      where: { id: { in: state.tags.map((t) => t.tagId) } },
      select: { id: true, ...EXAMINE_TAG_SELECT },
    })
    : [];

  // A row with no snapshot falls back to the live character, which carries no
  // `visibleRoleTitle` — so a line written before that key existed reads out no
  // role, the same way it already drops the faction-era `r` and `f`. The live
  // select above is deliberately NOT widened to fetch one: a live role read on a
  // frozen line is the thing this whole file exists to prevent.
  const subject = state ? rehydrateSubject({ live, state, tags: catalog }) : live;

  // Every duration counts against the turn the LINE was said, not today's — a
  // frozen `expiresTurn: 12` read on turn 20 would falsely render "expires
  // this turn". openTurn is still fetched: examineBlock needs its phase.
  const readoutTurn = (state ? row.turnNumber : null) ?? openTurn?.number;

  // A forced name is NOT a hood; both write to concealedAlias, told apart by
  // what the ROW froze, not the speaker's live tags (presentedIdentity.js#wasHooded).
  const forced = forcedNameFrom(subject.tags);
  const hooded = wasHooded(row, { forcedName: forced });

  const sightTags = bystander ? [] : (viewer.tags ?? []); // a camera gets none of the viewer's

  // A hood gets the impoverished read, so neither query below is worth running for one.
  const [skillCatalog, lastDesire] = await Promise.all([
    bystander ? [] : prisma.tag.findMany({ select: { id: true, parentTagId: true } }),
    !hooded && canSeeDesire(sightTags)
      ? prisma.desire.findFirst({
        where: {
          characterId: subject.id,
          status: "FULFILLED",
          // A Desire fulfilled AFTER the line can't be reported. The null arm
          // isn't optional: endedTurnNumber can be unset (fulfilled between
          // turns), and a bare `lte` never matches NULL — it would drop the most recent Desire.
          ...(readoutTurn == null
            ? {}
            : { OR: [{ endedTurnNumber: null }, { endedTurnNumber: { lte: readoutTurn } }] }),
        },
        orderBy: [{ endedTurnNumber: "desc" }, { id: "desc" }],
        select: { text: true, points: true },
      })
      : null,
  ]);

  return {
    readout: examineReadout({
      // Faked onto the subject shape so one readout serves both (db/lib/examine.js).
      subject: hooded ? { ...subject, concealed: true } : subject,
      viewerTags: sightTags,
      satisfied: bystander
        ? new Set()
        : satisfiedSkillIds(
          (viewer.tags ?? []).map((ct) => ct.tagId),
          buildSkillAncestry(skillCatalog),
        ),
      openTurnNumber: readoutTurn,
      lastDesire,
      wasConcealedAs: hooded ? (row.concealedAlias ?? null) : null, // the hood the room SAW
      viewerIsThanati: !bystander && (viewer.tags ?? []).some((ct) => ct.tag?.slug === THANATI_SLUG),
    }),
  };
}

module.exports = { VIEWER_SELECT, examineRow };
