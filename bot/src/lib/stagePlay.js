// The Makeshift Stage: music that plays whether or not anybody is performing.
//
// A structure type declares `placement.music: { mood, needs }` in
// docs/tags.yaml and this sweep, four times a day, posts a line into its
// Location and lifts the mood of everybody standing there.
//
// TWO THINGS HOLD IT BELOW THE MUSICIAN, and both are deliberate. A Musician's
// /play is +10 to every listener, once per listener per turn, and it costs a
// real player holding both Instrument and Musician the trouble of showing up
// (bot/src/events/interactionCreate.js#sootheListeners). A building that paid
// its full figure on every one of four daily firings would be worth about
// +32 a day for nothing, which is half again what the ROLE is worth.
//
//   1. The mood is rationed once per listener per TURN — the same AuditLog
//      ration /play keeps, just under its own actionType. A day is two turns,
//      so the Stage pays about +16 a day against the Musician's +20.
//   2. It only works while a Boombox is lying about in one of the Location's
//      Rooms. It is a stage with a stereo on it, not an orchestra.
//
// The LINE still posts on all four firings, ration or no: music playing is a
// fact about the place, and a room that has already been cheered up this turn
// can still hear it. What it cannot do is cheer them up twice.
//
// This lives on the bot rather than in a turn pass because the cadence is
// wall-clock — every six hours, not every close. It is a plain cron with no
// request behind it, the same reason whisperPoll and the rite sweep sit here.

const { prisma } = require("@lifeweb/db");
const { applyMood } = require("@lifeweb/db/lib/mood");
const { ambientLine } = require("@lifeweb/db/lib/ambientLine");
const { postMessage } = require("@lifeweb/db/lib/discordRest");
const { placementOf, WORKING_STATUSES } = require("@lifeweb/db/lib/structures");

// Bascinet's line, verbatim. It opens "You hear" because every audible thing
// in the game does (db/lib/bell.js).
const MUSIC_LINE = "You hear loud music playing.";

// One row per listener per turn, the shape REQUESTS.md §1a describes and
// /play's `mood_soothed_play` already uses. Its own actionType rather than
// sharing that one, so a Musician playing at a Stage is not silently robbed
// of their own once-a-turn lift — the two rations are separate lifts.
const STAGE_AUDIT_ACTION = "mood_stage";

async function runStagePlay(db = prisma) {
  const result = { played: 0, silent: 0, soothed: 0 };

  const rows = await db.structure.findMany({
    // WORKING_STATUSES: a damaged stage is still a platform with a stereo on
    // it. Only a ruin goes quiet.
    where: { status: { in: WORKING_STATUSES } },
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

  // One open turn for the whole sweep. No turn open means no ration to count
  // against, so nothing is paid — but the music still plays.
  const openTurn = await db.turn.findFirst({ where: { status: "OPEN" }, select: { id: true } });

  for (const row of rows) {
    const music = musicBySlug.get(row.typeSlug);
    if (!music) continue;
    // Per-row try/catch: one Location's Discord trouble must not stop the
    // rest of the sweep.
    try {
      // Is the thing that makes the noise actually here? Any Room at this
      // Location will do — the stash is the floor, and nobody has to be
      // holding it. A Location with no Rooms can therefore never hold one,
      // which is a real edge and an acceptable one.
      const boombox = await db.roomTag.findFirst({
        where: {
          quantity: { gt: 0 },
          room: { locationId: row.locationId },
          tag: { slug: music.needs },
        },
        select: { id: true },
      });
      if (!boombox) {
        // Silence, and deliberately no line about silence. A dead stage says
        // nothing at all; that absence is how a player learns the boombox is
        // what matters.
        result.silent += 1;
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
          // MUSIC's own kind, with the stage's figure rather than /play's.
          // applyMood clamps, re-projects the band and sends the band DM
          // itself; the audit row is the caller's job, which is why it is
          // written right here beside it (db/lib/mood.js).
          await applyMood(tx, id, { kind: "MUSIC", base: music.mood });
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
