// The Makeshift Stage: music that plays whether or not anybody is performing.
// A structure type declares `placement.music: { mood, needs }` in
// docs/tags.yaml and this sweep, four times a day, posts a line into its
// Location and lifts the mood of everybody standing there — deliberately
// held below the Musician's /play (+10/listener/turn): mood here is rationed
// once per listener per TURN under its own actionType (~+16/day vs the
// Musician's +20), and needs a Boombox lying in one of the Location's Rooms.
// The LINE still posts on every firing regardless of the ration. Lives on the
// bot rather than a turn pass since the cadence is wall-clock, like
// whisperPoll and the rite sweep.

const { prisma } = require("@lifeweb/db");
const { applyMood } = require("@lifeweb/db/lib/mood");
const { ambientLine } = require("@lifeweb/db/lib/ambientLine");
const { postMessage } = require("@lifeweb/db/lib/discordRest");
const { placementOf, WORKING_STATUSES } = require("@lifeweb/db/lib/structures");

const MUSIC_LINE = "You hear loud music playing."; // opens "You hear" like every audible thing (db/lib/bell.js)

// Own actionType rather than sharing /play's, so a Musician isn't silently
// robbed of their own once-a-turn lift.
const STAGE_AUDIT_ACTION = "mood_stage";

async function runStagePlay(db = prisma) {
  const result = { played: 0, silent: 0, soothed: 0 };

  const rows = await db.structure.findMany({
    where: { status: { in: WORKING_STATUSES } }, // a damaged stage still plays; only a ruin goes quiet
    select: {
      id: true,
      typeSlug: true,
      typeName: true,
      locationId: true,
      location: { select: { id: true, discordChannelId: true } },
    },
  });
  if (!rows.length) return result;

  const types = await db.tag.findMany({
    where: { slug: { in: [...new Set(rows.map((r) => r.typeSlug))] } },
    select: { slug: true, placement: true },
  });
  const musicBySlug = new Map();
  for (const t of types) {
    const m = placementOf(t)?.music;
    if (m) musicBySlug.set(t.slug, m);
  }
  if (!musicBySlug.size) return result;

  const openTurn = await db.turn.findFirst({ where: { status: "OPEN" }, select: { id: true } }); // no turn open, no ration, music still plays

  for (const row of rows) {
    const music = musicBySlug.get(row.typeSlug);
    if (!music) continue;
    try { // per-row: one Location's Discord trouble must not stop the rest of the sweep
      const boombox = await db.roomTag.findFirst({
        where: {
          quantity: { gt: 0 },
          room: { locationId: row.locationId },
          tag: { slug: music.needs },
        },
        select: { id: true },
      });
      if (!boombox) {
        result.silent += 1; // deliberately no line about silence
        continue;
      }

      if (row.location?.discordChannelId) {
        await postMessage(row.location.discordChannelId, ambientLine(MUSIC_LINE)).catch((err) =>
          console.error(`Stage line failed at ${row.typeName} (${row.id}):`, err),
        );
      }
      result.played += 1;

      if (!openTurn) continue;

      const listeners = await db.character.findMany({
        where: { locationId: row.locationId, status: "ALIVE" },
        select: { id: true },
      });
      if (!listeners.length) continue;
      const paidAlready = new Set(
        (
          await db.auditLog.findMany({
            where: {
              actionType: STAGE_AUDIT_ACTION,
              turnId: openTurn.id,
              targetCharacterId: { in: listeners.map((c) => c.id) },
            },
            select: { targetCharacterId: true },
          })
        ).map((r) => r.targetCharacterId),
      );
      for (const { id } of listeners) {
        if (paidAlready.has(id)) continue;
        await db.$transaction(async (tx) => {
          await applyMood(tx, id, { kind: "MUSIC", base: music.mood }); // audit row is the caller's job (db/lib/mood.js)
          await tx.auditLog.create({
            data: {
              actorDiscordUserId: "system",
              actionType: STAGE_AUDIT_ACTION,
              targetCharacterId: id,
              turnId: openTurn.id,
              details: { structureId: row.id, locationId: row.locationId, mood: music.mood },
            },
          });
        });
        result.soothed += 1;
      }
    } catch (err) {
      console.error(`Stage sweep failed for ${row.typeName} (${row.id}):`, err);
    }
  }

  return result;
}

module.exports = {
  runStagePlay,
};
