import { cache } from "react";
import "server-only";
import { prisma } from "@lifeweb/db";
import { placesFor as placesForCharacter, findPlace, mayReadPlace, mayWritePlace } from "@lifeweb/db/lib/feedAccess";
import { feedWipeFloors, placeSeqWhere } from "@lifeweb/db/lib/feedWipe";
import { isPlayerGhost } from "@lifeweb/db/lib/ghost";
import { getGmSession } from "@/lib/discordGuild";
import { readChatViewAs } from "@/lib/viewAs";

// The web's half of the feed gate; rules live in db/lib/feedAccess.js. What's left: the viewer load — the session says who is asking, never a posted character id.

export { findPlace, mayReadPlace, mayWritePlace };

// placesFor plus two numbers, as STRINGS (seq is bigint): `newestSeq` seeds Chat.js's read marks;
// `notableSeq` (a {char:…} mention or conversation row, never the viewer's own) drives the unread dot (CHAT.md §5).
export async function placesFor(client, character, options) {
  const places = await placesForCharacter(client, character, options);
  if (places.length === 0) return places;

  const newest = new Map();
  try {
    // Above each place's own watermark (db/lib/feedWipe.js); summaries and Locations/Rooms clear on different days.
    const floors = await feedWipeFloors(client);
    const grouped = await client.archiveEntry.groupBy({
      by: ["placeKey"],
      where: {
        ...placeSeqWhere(floors, places.map((entry) => entry.placeKey)),
        deletedAt: null,
      },
      _max: { seq: true },
    });
    for (const row of grouped) {
      if (row.placeKey && row._max?.seq !== null && row._max?.seq !== undefined) {
        newest.set(row.placeKey, String(row._max.seq));
      }
    }
  } catch (err) {
    // A missing dot is cosmetic; a place list that failed to load is not.
    console.error("Feed place watermarks failed:", err);
  }

  const notable = await notableWatermarks(client, places, character);

  return places.map((entry) => ({
    ...entry,
    newestSeq: newest.get(entry.placeKey) ?? null,
    notableSeq: notable.get(entry.placeKey) ?? null,
  }));
}

// The newest row where SOMEBODY SPOKE (not the viewer's own, source not SYSTEM); works with no character on purpose — a GM in Chat is in GM mode BECAUSE they have none.
async function notableWatermarks(client, places, character) {
  const out = new Map();
  const allKeys = places.map((entry) => entry.placeKey);
  if (allKeys.length === 0) return out;

  try {
    // Same per-place floors placesFor uses above; placeSeqWhere scopes placeKey itself, replacing the `in` clause.
    const floors = await feedWipeFloors(client);

    // Null arm, not a bare `NOT`: a proxied row with no characterId would else be dropped by `NOT: { characterId: me }`.
    const notMine = character?.id
      ? { OR: [{ characterId: null }, { characterId: { not: character.id } }] }
      : {};

    const rows = await client.archiveEntry.groupBy({
      by: ["placeKey"],
      where: {
        deletedAt: null,
        // SYSTEM is the game talking to itself; held back so the rule stays "somebody spoke".
        source: { not: "SYSTEM" },
        ...notMine,
        ...placeSeqWhere(floors, allKeys),
      },
      _max: { seq: true },
    });

    for (const row of rows) {
      const seq = row._max?.seq;
      if (!row.placeKey || seq === null || seq === undefined) continue;
      out.set(row.placeKey, String(seq));
    }
  } catch (err) {
    // Same posture as the watermarks above.
    console.error("Feed notable watermarks failed:", err);
  }

  return out;
}

export async function loadFeedCharacter(discordUserId) {
  if (!discordUserId) return null;
  return prisma.character.findFirst({
    where: { discordUserId, status: "ALIVE" },
    select: {
      id: true,
      name: true,
      concealed: true,
      age: true,
      gender: true,
      updatedAt: true,
      locationId: true,
      // discordMirrored is the chip in the places column (CHAT.md §6).
      discordMirrored: true,
      // The estate their own name is painted in — the two routes that shape a
      // row by hand (say, edit) have no batch loader to get it from.
      role: { select: { groupSlug: true } },
      location: {
        select: { id: true, name: true, description: true, indoors: true, zone: { select: { id: true, name: true, description: true } } },
      },
    },
  });
}

// Who is looking, and on what terms. A GM with no living character still gets
// a Chat — a read-only one over the zones their GmZoneView allows — and a GM
// who DOES have a living character CHOOSES, from the View as switch at the
// foot of the places column: their own scene by default, because the
// alternative is a GM who cannot use their own sheet, or the watcher's view of
// every zone they hold. That choice is a cookie (web/lib/viewAs.js) rather
// than a column, and it is read here and nowhere else. A dead player whose body
// still lies in the world is a GHOST: a read-only Chat over every zone, the
// seat their Discord role already gives them (CHANNELS.md §5).
//
// Whether they are a ghost is db/lib/ghost.js's question and nobody else's — a body, and no living
// character. It ends ONE way: a living character is theirs again, by re-roll, rite, spawn or a GM's
// revive. Burial and engraving do not touch it.
//
// This used to be db/lib/curse.js, which answers a different question — who pays the re-roll penalty
// — and answers it with `buriedAt`. Sharing one predicate meant burying a body, the act that LIFTS
// that penalty, also threw the player out of the game they were still watching. The two are separate
// now and must stay separate: curse.js still decides points, and nothing but ghost.js decides seats.
//
// `options` is what every db/lib/feedAccess.js call needs:
// `{ gm, ghost, discordUserId }`.
// cache()d because every page's header asks for it now (AppHeader -> TurnMeta)
// and /chat asks again for its own load. One small indexed lookup either way,
// but there is no reason for a page to run it twice in a request.
export const loadFeedViewer = cache(async () => {
  const { session, isGm, inGuild } = await getGmSession();
  // Departed the guild: no read (and, via /api/feed/say, no write) of Chat or
  // Deadchat — a session surviving OAuth is not the same as still having web
  // access (root CLAUDE.md "Web app auth"). Treated exactly like signed out.
  if (!session?.discordUserId || !inGuild) {
    return { discordUserId: null, character: null, playing: null, canViewAsGm: false, gm: false, ghost: false, options: null };
  }

  const playing = await loadFeedCharacter(session.discordUserId);
  // Independent of `gm`: a GM whose own character died is a ghost too. They
  // keep the GM's view of the world and gain the one thing a ghost has that a
  // GM does not, a voice in Deadchat (db/lib/feedAccess.js#gmPlacesFor).
  //
  // Asked of the REAL character, above the switch below — a GM who has chosen
  // the GM seat has a living character and is not a ghost, and reading this
  // off the nulled one would have seated them in the dead room.
  const ghost = !playing && (await isPlayerGhost(prisma, session.discordUserId));

  // A GM with no character is in GM mode and has nothing to switch to. A GM
  // who IS playing somebody chooses, and the choice is a cookie
  // (web/lib/viewAs.js). `canViewAsGm` is what draws the switch at the foot of
  // the places column; nobody else is offered one.
  const canViewAsGm = Boolean(isGm) && Boolean(playing);
  const gm = Boolean(isGm) && (!playing || (await readChatViewAs()) === "gm");

  // THE ONE LINE that makes the switch reach everywhere. Every feed surface
  // reads `viewer.character` and `viewer.options` — /chat's render, the SSE
  // stream, history, places, search — and placesFor ignores the character
  // entirely once `gm` is set (db/lib/feedAccess.js). Handing them null in the
  // GM seat is what makes all of them take the watcher's path with no edit of
  // their own: page.js builds no right column and computes `gmZones`, Feed.js
  // draws no composer. `playing` rides alongside for anyone who needs to know
  // there is a body behind the seat.
  const character = gm ? null : playing;
  return {
    discordUserId: session.discordUserId,
    character,
    playing,
    canViewAsGm,
    gm,
    ghost,
    options: { gm, ghost, discordUserId: session.discordUserId },
  };
});
