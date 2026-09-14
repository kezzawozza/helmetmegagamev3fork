import { cache } from "react";
import "server-only";
import { prisma } from "@lifeweb/db";
import { placesFor as placesForCharacter, findPlace, mayReadPlace, mayWritePlace } from "@lifeweb/db/lib/feedAccess";
import { feedWipeFloors, placeSeqWhere } from "@lifeweb/db/lib/feedWipe";
import { getGmSession } from "@/lib/discordGuild";

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
      // webOnly is the chip in the places column (CHAT.md §6).
      webOnly: true,
      location: {
        select: { id: true, name: true, description: true, indoors: true, zone: { select: { id: true, name: true, description: true } } },
      },
    },
  });
}

// Who is looking: a GM with no character gets a read-only Chat over their GmZoneView zones, else plays their character. cache()d since every page's header asks for it, not only /chat.
export const loadFeedViewer = cache(async () => {
  const { session, isGm } = await getGmSession();
  if (!session?.discordUserId) return { discordUserId: null, character: null, gm: false, options: null };

  const character = await loadFeedCharacter(session.discordUserId);
  const gm = Boolean(isGm) && !character;
  return {
    discordUserId: session.discordUserId,
    character,
    gm,
    options: { gm, discordUserId: session.discordUserId },
  };
});
