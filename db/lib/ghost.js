// Who is a GHOST — the watching seat. `ghost(player) := they have a body, and no ALIVE character`. A dead player reads the game from `/chat` and talks in Deadchat (db/lib/deadchatAccess.js)
// until they take a new body, and nothing else ends it.
//
// NOT the curse (db/lib/curse.js), which answers a different question with a different rule and
// drives only the re-roll penalty (migrant/bum only, six fewer points). The two used to be one
// predicate, so burying a body — which is supposed to LIFT a re-roll penalty — also evicted that
// player from watching the game. Burial says nothing about who may watch; only re-rolling does.
//
// Takes `prisma` as a parameter rather than requiring db/index.js: that would resolve to a partial
// exports object (the db/lib/dm.js convention).

// The fields the rule reads. **Export and use it.** The trap here is the mirror of curse.js's
// `buriedAt` one, and worse: the rule needs to see the rows this player has that are NOT dead, so a
// caller who narrows the query — `where: { discordUserId, status: "DEAD" }` — never loads the ALIVE
// row, and the rule answers "ghost" for somebody still playing. That seats a living player in the
// dead room. **Never filter by status; load the player's rows and let isGhostIn decide.**
//
// curse.js's CURSE_SELECT is a superset of this, so a caller already holding cursed rows may pass
// them straight in. The reverse is not true — these rows carry no `buriedAt`, and curse.js reads a
// missing one as "still lying there".
const GHOST_SELECT = {
  discordUserId: true,
  status: true,
};

// The rule itself, over rows already in hand. PURE — no prisma, no await, like cursedUserIds, since
// the bulk call sites (the channel doctor) already loaded every Character row.
//
// No ordering and no override: "any DEAD row" does not care which body was most recent, and
// `cursedOverride` is a GM's thumb on the re-roll penalty, not on who may watch.
function isGhostIn(characters) {
  const rows = characters ?? [];
  // Empty degrades to "not a ghost" on purpose: a mis-scoped caller (see the header) then fails
  // CLOSED, costing a dead player their seat until someone notices, rather than seating a living
  // player among the dead.
  if (rows.length === 0) return false;
  if (rows.some((row) => row?.status === "ALIVE")) return false;
  // `!== "ALIVE"`, not `=== "DEAD"`: CharacterStatus also carries the vestigial CURSED value, and
  // curse.js already counts it as a body (db/test/curse.test.js, "the dead CURSED enum value counts
  // as not-ALIVE"). What a body IS should be the one thing these two predicates still agree on.
  return rows.some((row) => row?.status && row.status !== "ALIVE");
}

// Every player who is a ghost, out of rows for many of them. Mirrors curse.js#cursedUserIds so the
// two can be read side by side.
function ghostUserIds(rows) {
  const byUser = new Map();
  for (const row of rows ?? []) {
    if (!row?.discordUserId) continue;
    const list = byUser.get(row.discordUserId);
    if (list) list.push(row);
    else byUser.set(row.discordUserId, [row]);
  }

  const ghosts = new Set();
  for (const [discordUserId, characters] of byUser) {
    if (isGhostIn(characters)) ghosts.add(discordUserId);
  }
  return ghosts;
}

// The query wrapper for call sites holding no rows (the feed viewer, the SSE stream's re-check).
// One findMany over the player's WHOLE roster, reduced in memory — never a count keyed on DEAD,
// which is the trap the header describes.
async function isPlayerGhost(prisma, discordUserId) {
  if (!discordUserId) return false;
  const rows = await prisma.character.findMany({
    where: { discordUserId },
    select: GHOST_SELECT,
  });
  return isGhostIn(rows);
}

// WHICH dead character a ghost speaks as in Deadchat: their most recent body. Newest by `createdAt`,
// the only ordering a Character row carries — curse.js#newestFirst uses the same one.
//
// Returns null when the player has an ALIVE character, so the gate (isPlayerGhost, through
// placesFor) and the speaker resolution can never disagree about who is a ghost. The select mirrors
// web/lib/feedAccess.js#loadFeedCharacter's, plus `discordUserId`: presentedIdentity and the
// Deadchat name both read off these fields, and a missing one throws rather than degrades.
async function ghostCharacterFor(prisma, discordUserId) {
  if (!discordUserId) return null;
  const rows = await prisma.character.findMany({
    where: { discordUserId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      status: true,
      discordUserId: true,
      concealed: true,
      age: true,
      gender: true,
      updatedAt: true,
      locationId: true,
      webOnly: true,
    },
  });
  if (!isGhostIn(rows)) return null;
  return rows.find((row) => row.status !== "ALIVE") ?? null;
}

module.exports = { isPlayerGhost, isGhostIn, ghostUserIds, ghostCharacterFor, GHOST_SELECT };
