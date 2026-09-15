// Who a viewer has SEEN SPEAK this turn, and what they looked like doing it.
// Standing in a room is public; what is over your face is not — a face has
// to be earned by a line sat in a place your feed shows you, in the open
// turn, and the sighting dies with the turn.
//
// What comes back is FROZEN at the last such line rather than read live: a
// hood put on after you heard them speak does not protect them from you.
// ArchiveEntry already froze both halves at send time (concealedAlias,
// presentedAvatarPath), so this reads them back rather than recomputing an
// identity that has since moved.
const { placesFor } = require("./feedAccess");

// A concealed row whose face was never recorded cannot be given one now
// (guessing from today's tags could unmask somebody); `unknownFace` draws the
// question-mark plate instead, CSS not a file (CharacterAvatar.js).
function shapeSighting(row) {
  const alias = row.concealedAlias ?? null;
  return {
    seq: String(row.seq),
    name: alias ?? row.characterName ?? null,
    concealed: Boolean(alias),
    avatarPath: row.presentedAvatarPath ?? null,
    unknownFace: Boolean(alias) && !row.presentedAvatarPath,
  };
}

// Returns Map<characterId, { seq, name, concealed, avatarPath, unknownFace }>.
// An absent key means unseen — never an error. Place scope comes from
// db/lib/feedAccess.js#placesFor rather than being rebuilt here, the one
// answer to what a viewer may read.
// `ghost` is a dead player (db/lib/ghost.js). Their place list is every zone summary, Location and
// public Room, so they have "seen speak" anyone who spoke anywhere in the open turn — which is what
// watching the whole board means. Nothing special is computed for them here: the scope still comes
// from placesFor, the one answer to what a viewer may read.
async function lastSightings(prisma, character, { gm = false, ghost = false, discordUserId = null } = {}) {
  const empty = new Map();
  if (!character?.id && !gm) return empty;

  const [places, open] = await Promise.all([
    placesFor(prisma, character, { gm, ghost, discordUserId }),
    prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } }),
  ]);
  // Between turns nobody has been seen — every face withheld, the safe
  // direction to fail in.
  if (places.length === 0 || open?.number == null) return empty;

  const keys = places.map((entry) => entry.placeKey).filter(Boolean);
  if (keys.length === 0) return empty;

  try {
    // Newest surviving line per speaker, two queries rather than one raw
    // DISTINCT ON (the groupBy-then-fetch shape notableWatermarks uses).
    const grouped = await prisma.archiveEntry.groupBy({
      by: ["characterId"],
      where: {
        // A MESSAGE, not an event: a death or fulfilled Desire can carry a
        // characterId and placeKey, which would hand somebody an eye pointed
        // at a row db/lib/examineRow.js refuses outright.
        kind: "MESSAGE",
        placeKey: { in: keys },
        turnNumber: open.number,
        deletedAt: null,
        characterId: { not: null },
      },
      _max: { seq: true },
    });

    const seqs = grouped.map((entry) => entry._max?.seq).filter((seq) => seq !== null && seq !== undefined);
    if (seqs.length === 0) return empty;

    const rows = await prisma.archiveEntry.findMany({
      where: { seq: { in: seqs } },
      select: {
        seq: true,
        characterId: true,
        characterName: true,
        concealedAlias: true,
        presentedAvatarPath: true,
      },
    });

    const out = new Map();
    for (const row of rows) {
      if (row.characterId) out.set(row.characterId, shapeSighting(row));
    }
    return out;
  } catch (err) {
    // A failed read costs everybody their face for one render — the quiet
    // direction.
    console.error("Sightings read failed:", err);
    return empty;
  }
}

module.exports = { lastSightings };
