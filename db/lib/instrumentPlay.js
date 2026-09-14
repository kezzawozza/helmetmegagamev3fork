// /play. Shared between the bot's own slash command and the web's Chat
// composer (COMMANDS.md, db/lib/roll.js's castDie is the template) so a lute plays the same way — same
// cooldown, mood soothe, room line — on both faces. WHY THE ROOM LINE IS FULL SIZE, NOT `-#` SUBTEXT:
// CLAUDE.md says a line the WORLD says into a channel is subtext, and the ambient line to the parent
// Location channel below obeys that, but the room is where the performance is happening — an event in
// the scene, not scenery under it — so the scene half deliberately does not; don't "fix" the asymmetry.
// Takes `prisma` as a parameter, off the @lifeweb/db barrel like db/lib/dm.js; require it by path.
//
// Holding `instrument` is no longer the gate on the command itself, only on which of the two
// performances you give: an instrument in hand plays, an empty-handed character sings instead. Either
// one is a performance and either one can soothe a room, singing just carries less of a lift.

const { sceneLine } = require("./scene");
const { ambientLine } = require("./ambientLine");
const { discordTargetForPlaceKey } = require("./placeKey");
const { postMessage } = require("./discordRest");
const { applyMood } = require("./mood");
const { EVENTS } = require("./mood");
const { INSTRUMENT_SLUG, MUSICIAN_SLUG, MUSICIAN_PYTHAGOREAN_SLUG } = require("./constants");

const NOTE_GLYPHS = ["♫", "♩", "♪", "♬"];

// AuditLog-backed, not an in-memory Map — bot and web are separate Railway services, so a Map in
// either only cools that one face down (REQUESTS.md's reasoning for rationing by row, not column).
const PLAY_COOLDOWN_MS = 5 * 60_000;
const PLAY_AUDIT_ACTION = "instrument_played";
const PLAY_SOOTHE_AUDIT_ACTION = "mood_soothed_play";

// A voice carries less than an instrument does. Same ×4 Pythagorean mastery
// on top (EVENTS.MUSIC is the instrument's own base — see sootheListeners).
const SING_BASE = 8;

// Three glyphs, repeats allowed — so ♩♩♪ is a legal result.
function noteFlourish() {
  return Array.from({ length: 3 }, () => NOTE_GLYPHS[Math.floor(Math.random() * NOTE_GLYPHS.length)]).join("");
}

function held(character, slug) {
  return (character.tags ?? []).some((ct) => ct.tag?.slug === slug && (ct.quantity ?? 1) > 0);
}

// `base` mood to every living character at the musician's Location, musician included — EVENTS.MUSIC
// (10) for an instrument, SING_BASE (8) a cappella. Rationed by an AuditLog row per listener with
// turnId set (REQUESTS.md §1a).
async function sootheListeners(prisma, musician, { base = EVENTS.MUSIC, quadruple = false } = {}) {
  if (!musician.locationId) return;
  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true } });
  if (!openTurn) return;
  const listeners = await prisma.character.findMany({
    where: { locationId: musician.locationId, status: "ALIVE" },
    select: { id: true },
  });
  const soothedAlready = new Set(
    (
      await prisma.auditLog.findMany({
        where: {
          actionType: PLAY_SOOTHE_AUDIT_ACTION,
          turnId: openTurn.id,
          targetCharacterId: { in: listeners.map((c) => c.id) },
        },
        select: { targetCharacterId: true },
      })
    ).map((row) => row.targetCharacterId),
  );
  for (const { id } of listeners) {
    if (soothedAlready.has(id)) continue;
    await prisma.$transaction(async (tx) => {
      // Musician (Pythagorean) quadruples it. Passed as an explicit `base` rather than added to
      // mood.js's MULTIPLIERS — that table is consulted only for harm, keyed on the LISTENER's tags.
      await applyMood(tx, id, { kind: "MUSIC", base: base * (quadruple ? 4 : 1) });
      await tx.auditLog.create({
        data: {
          actorDiscordUserId: musician.discordUserId ?? "system",
          actionType: PLAY_SOOTHE_AUDIT_ACTION,
          targetCharacterId: id,
          turnId: openTurn.id,
          locationId: musician.locationId ?? null,
          details: { musicianId: musician.id, locationId: musician.locationId },
        },
      });
    });
  }
}

// `character` needs { id, discordUserId, locationId, tags: [{ tag: { slug, quantity? } }] }.
async function playInstrument(prisma, character, placeKey) {
  if (!character?.id) return { ok: false, error: "You don't have a living character." };
  if (!placeKey) return { ok: false, error: "There's nobody here to hear it." };

  const hasInstrument = held(character, INSTRUMENT_SLUG);

  const last = await prisma.auditLog.findFirst({
    where: { actionType: PLAY_AUDIT_ACTION, targetCharacterId: character.id },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const since = last ? Date.now() - last.createdAt.getTime() : Infinity;
  if (since < PLAY_COOLDOWN_MS) {
    const minutes = Math.max(1, Math.ceil((PLAY_COOLDOWN_MS - since) / 60_000));
    return { ok: false, error: `Let the last one finish — about ${minutes} more minute${minutes === 1 ? "" : "s"}.` };
  }

  const isMusician = held(character, MUSICIAN_SLUG);
  const verb = hasInstrument ? "an instrument playing" : "someone singing";
  const line = isMusician
    ? `You hear ${verb}, beautifully. ${noteFlourish()}`
    : `You hear ${verb}, badly. ${noteFlourish()}`;

  // Archive row first — it's what Chat shows, and the only half a web-only player ever sees.
  await sceneLine(prisma, { placeKey, text: line, signed: false });

  let target = null;
  try {
    target = await discordTargetForPlaceKey(prisma, placeKey);
    const channelId = target?.threadId ?? target?.channelId ?? null;
    if (channelId) await postMessage(channelId, line, undefined, { parse: [] });
  } catch (err) {
    console.error("Play post failed:", err.message ?? err);
  }

  // Claimed only after the performance happens, so a dead channel never costs the cooldown.
  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: character.discordUserId ?? "system",
        actionType: PLAY_AUDIT_ACTION,
        targetCharacterId: character.id,
        details: { placeKey },
      },
    })
    .catch((err) => console.error("Play audit log failed:", err));

  // A musician's performance settles everyone in earshot, once per listener per turn (MOOD.md) — a bad
  // performance calms nobody. Singing carries a smaller lift than an instrument (SING_BASE vs.
  // EVENTS.MUSIC). Wrapped so the dial can never swallow the performance.
  if (isMusician) {
    await sootheListeners(prisma, character, {
      base: hasInstrument ? EVENTS.MUSIC : SING_BASE,
      quadruple: held(character, MUSICIAN_PYTHAGOREAN_SLUG),
    }).catch((err) => console.error(`play: soothing failed for ${character.id}:`, err.message ?? err));
  }

  // ...and the street outside hears it, small. `target.channelId` is already the parent Location
  // channel — discordTargetForPlaceKey resolves a Room/Conversation's owning channel already.
  if (target?.channelId) {
    await postMessage(target.channelId, ambientLine(line)).catch(() => null);
  }

  return { ok: true, line: hasInstrument ? "You play." : "You sing." };
}

module.exports = {
  playInstrument,
};
