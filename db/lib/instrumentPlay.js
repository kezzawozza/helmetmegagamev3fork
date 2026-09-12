// /play, the `instrument` tag's one verb. Shared between the bot's own
// slash command and the web's Chat composer (COMMANDS.md, `db/lib/roll.js`'s
// castDie is the template this follows) so a lute plays the same way — same
// cooldown, same mood soothe, same room line — on both faces.
//
// WHY THE ROOM LINE IS FULL SIZE, NOT `-#` SUBTEXT. CLAUDE.md says a line the
// WORLD says into a channel is subtext, and the ambient line to the parent
// Location channel below obeys that. The scene half deliberately does not, at
// Bascinet's direction: the room is where the performance is happening, so it
// is an event in the scene rather than scenery under it. Don't "fix" the
// asymmetry — it is the feature.
//
// Takes `prisma` as a parameter and stays off the @lifeweb/db barrel, the
// db/lib/dm.js convention; require it by path.

const { sceneLine } = require("./scene");
const { ambientLine } = require("./ambientLine");
const { discordTargetForPlaceKey } = require("./placeKey");
const { postMessage } = require("./discordRest");
const { applyMood } = require("./mood");
const { EVENTS } = require("./mood");
const { INSTRUMENT_SLUG, MUSICIAN_SLUG, MUSICIAN_PYTHAGOREAN_SLUG } = require("./constants");

const NOTE_GLYPHS = ["♫", "♩", "♪", "♬"];

// AuditLog-backed, not an in-memory Map: the bot and the web are two separate
// Railway services, so a Map in either one only cools that one face down.
// This is the same reasoning REQUESTS.md gives for rationing by row instead
// of by column — the row is the one thing both processes can both see.
const PLAY_COOLDOWN_MS = 5 * 60_000;
const PLAY_AUDIT_ACTION = "instrument_played";
const PLAY_SOOTHE_AUDIT_ACTION = "mood_soothed_play";

// Three glyphs, repeats allowed — "a random combination of 3", not three
// distinct ones, so ♩♩♪ is a legal result.
function noteFlourish() {
  return Array.from({ length: 3 }, () => NOTE_GLYPHS[Math.floor(Math.random() * NOTE_GLYPHS.length)]).join("");
}

function held(character, slug) {
  return (character.tags ?? []).some((ct) => ct.tag?.slug === slug && (ct.quantity ?? 1) > 0);
}

// +10 mood to every living character standing at the musician's Location, the
// musician included. The ration is an AuditLog row per listener with turnId
// set (REQUESTS.md §1a); /play is rate-limited to one every few minutes and a
// room holds a dozen people at most, so the rows stay few.
async function sootheListeners(prisma, musician, { quadruple = false } = {}) {
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
      // Musician (Pythagorean) quadruples it. Passed as an explicit `base`
      // rather than added to mood.js's MULTIPLIERS: that table is only
      // consulted for harm, and it keys on the LISTENER's tags — this is the
      // player's own doing, and it lands on everyone in the room.
      await applyMood(tx, id, { kind: "MUSIC", base: EVENTS.MUSIC * (quadruple ? 4 : 1) });
      await tx.auditLog.create({
        data: {
          actorDiscordUserId: musician.discordUserId ?? "system",
          actionType: PLAY_SOOTHE_AUDIT_ACTION,
          targetCharacterId: id,
          turnId: openTurn.id,
          details: { musicianId: musician.id, locationId: musician.locationId },
        },
      });
    });
  }
}

// `character` needs { id, discordUserId, locationId, tags: [{ tag: { slug, quantity? } }] }.
// Returns { ok, line } or { ok: false, error }.
async function playInstrument(prisma, character, placeKey) {
  if (!character?.id) return { ok: false, error: "You don't have a living character." };
  if (!placeKey) return { ok: false, error: "There's nobody here to hear it." };

  if (!held(character, INSTRUMENT_SLUG)) {
    return { ok: false, error: "You have nothing to play." };
  }

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
  const line = isMusician
    ? `You hear an instrument playing, beautifully. ${noteFlourish()}`
    : `You hear an instrument playing, badly. ${noteFlourish()}`;

  // The archive row first: it is what Chat shows, and it is the only half a
  // web-only player ever sees. Full size — see the header note.
  await sceneLine(prisma, { placeKey, text: line, signed: false });

  let target = null;
  try {
    target = await discordTargetForPlaceKey(prisma, placeKey);
    const channelId = target?.threadId ?? target?.channelId ?? null;
    if (channelId) await postMessage(channelId, line, undefined, { parse: [] });
  } catch (err) {
    console.error("Play post failed:", err.message ?? err);
  }

  // Claimed only once the performance itself has happened, so a dead channel
  // never costs the cooldown for a row that still landed in the archive.
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

  // A musician's playing settles everyone in earshot, once per listener per
  // turn (MOOD.md). Only a MUSICIAN's: a bad performance calms nobody.
  // Wrapped, so the dial can never swallow the performance.
  if (isMusician) {
    await sootheListeners(prisma, character, { quadruple: held(character, MUSICIAN_PYTHAGOREAN_SLUG) }).catch((err) =>
      console.error(`play: soothing failed for ${character.id}:`, err.message ?? err),
    );
  }

  // ...and the street outside hears it, small. `target.channelId` is already
  // the parent Location channel — discordTargetForPlaceKey resolves a Room or
  // Conversation's owning channel for exactly this reason (the outbox needs
  // it for the webhook), so no second lookup is needed here.
  if (target?.channelId) {
    await postMessage(target.channelId, ambientLine(line)).catch(() => null);
  }

  return { ok: true, line: "You play." };
}

module.exports = { playInstrument, PLAY_COOLDOWN_MS, PLAY_AUDIT_ACTION, PLAY_SOOTHE_AUDIT_ACTION };
