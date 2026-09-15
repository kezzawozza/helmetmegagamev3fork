// Who is Cursed — the re-roll penalty (next character may only be Migrant/Bum, six fewer points —
// web/lib/characterCreation.js's CURSED_ROLE_SLUGS/CURSED_POINT_PENALTY). NOT the watching seat,
// which is db/lib/ghost.js and reads no `buriedAt` at all: burial LIFTS this penalty and leaves that
// seat alone. The two were one predicate until the split, so burying a body also evicted the player
// from the game they were still watching. Keep them apart. `cursed(player) := most recent body still lying in the
// world, and no living character` — MOST RECENT only, not any (CORPSES.md §6/§7, CHARACTERS.md §4).
// Both halves are already columns: `Character.buriedAt` (BURY_CHARACTER/ENGRAVE_HEADSTONE, cleared on
// revive) and having an ALIVE character. `Character.cursedOverride` is a GM's thumb on the scale from
// the character dev panel: null means "work it out", true/false forces it.

// The fields the rule reads. **Export and use it** — a caller that omits `buriedAt` from its own
// `select` gets `undefined`, not `null`, and the rule silently answers wrong (db/lib/channelDoctor.js
// is exactly that trap).
const CURSE_SELECT = {
  discordUserId: true,
  status: true,
  buriedAt: true,
  cursedOverride: true,
  createdAt: true,
};

// Newest first. `createdAt` is the only ordering a Character row carries.
const newestFirst = (a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0);

// The rule itself, over rows already in hand. PURE — no prisma, no await, since the three bulk call
// sites (GM roster desks, channel doctor) already loaded every Character row. `rows` must carry CURSE_SELECT's fields.
function cursedUserIds(rows) {
  const byUser = new Map();
  for (const row of rows ?? []) {
    if (!row?.discordUserId) continue;
    const list = byUser.get(row.discordUserId);
    if (list) list.push(row);
    else byUser.set(row.discordUserId, [row]);
  }

  const cursed = new Set();
  for (const [discordUserId, characters] of byUser) {
    if (isCursedIn(characters)) cursed.add(discordUserId);
  }
  return cursed;
}

// The same rule for one player's rows. Split out so the single-character answer and the bulk one cannot drift.
function isCursedIn(characters) {
  const rows = [...(characters ?? [])].sort(newestFirst);

  // A GM's override wins over everything, including a living character. Most recently decided row wins.
  const override = rows.find((r) => r.cursedOverride !== null && r.cursedOverride !== undefined);
  if (override) return override.cursedOverride === true;

  if (rows.some((r) => r.status === "ALIVE")) return false;

  const latestBody = rows.find((r) => r.status !== "ALIVE");
  if (!latestBody) return false;
  // `!buriedAt` rather than `=== null`: a caller that forgot the column defaults to "still lying
  // there", which costs a live player a ghost role rather than silently handing out full-points re-rolls.
  return !latestBody.buriedAt;
}

// The query wrapper for call sites holding no rows (creation gates, dev panel). Takes `prisma` as a
// parameter, the db/lib/dm.js convention. One findMany, reduced in memory — never two counts, which
// can disagree across a bury committing between them. Pass `prisma`, not a transaction client: inside
// the character-creation transaction the new ALIVE row already exists, which would invert the answer.
async function isPlayerCursed(prisma, discordUserId) {
  if (!discordUserId) return false;
  const rows = await prisma.character.findMany({
    where: { discordUserId },
    select: CURSE_SELECT,
  });
  return isCursedIn(rows);
}

module.exports = { isPlayerCursed, isCursedIn, cursedUserIds, CURSE_SELECT };
