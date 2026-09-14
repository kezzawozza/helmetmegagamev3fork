// A loud noise, heard across the Location graph: pick an origin Location, walk out, post one line into every Location channel in earshot.
// db/lib/locationGraph.js#soundRange answers WHO hears; this file answers HOW LOUD. Unlike /shout, nothing muffles and there's no direction — only
// the volume band: full size near the source, `-#` subtext past that. Takes `prisma` as a parameter, off the @lifeweb/db barrel; require it by path.
const { ambientLine } = require("./ambientLine");
const { postMessage } = require("./discordRest");
const { soundRange } = require("./locationGraph");
const { sceneLineAt } = require("./scene");

// Sound does not cross surface/underground — Zone.kind, SYMMETRIC to the origin (not "surface only"), so a bell doesn't reach the Depths but a trumpet blown underground still reaches nearby listeners.
function carriesTo(originKind, kind) {
  return Boolean(kind) && kind === originKind;
}

// Posts `text` into every reachable Location within `maxHops` (loud within `loudHops`, else subtext). Returns { sent, failed } rather than throwing.
async function broadcastSound(prisma, { originLocationId, text, maxHops, loudHops, signed = true }) {
  if (!originLocationId || !process.env.DISCORD_TOKEN) return { sent: 0, failed: [] };

  const heard = await soundRange(prisma, originLocationId, maxHops);
  if (heard.length === 0) return { sent: 0, failed: [] };

  // soundRange returns ids, not zones — one query for the whole set rather than one per Location.
  const zones = await prisma.location.findMany({
    where: { id: { in: heard.map((place) => place.locationId) } },
    select: { id: true, zone: { select: { kind: true } } },
  });
  const kindById = new Map(zones.map((loc) => [loc.id, loc.zone?.kind ?? null]));
  const originKind = kindById.get(originLocationId) ?? null;
  if (!originKind) return { sent: 0, failed: [] };
  const reachable = new Set(
    zones.filter((loc) => carriesTo(originKind, loc.zone?.kind)).map((loc) => loc.id),
  );

  const loud = text;
  const quiet = ambientLine(text, [], { signed });

  // Sequential (a fan-out would burst Discord's rate limits); Location CHANNELS only, never Room threads under them — /shout's rules too.
  let sent = 0;
  const failed = [];
  for (const place of heard) {
    if (!place.discordChannelId) continue;
    if (!reachable.has(place.locationId)) continue;
    try {
      // parse: [] — the widest broadcast in the game should not be able to ping anybody by accident.
      await postMessage(
        place.discordChannelId,
        place.distance <= loudHops ? loud : quiet,
        undefined,
        { parse: [] },
      );
      sent += 1;
    } catch (err) {
      failed.push(place.name);
      console.error(`Sound carrying to ${place.name} failed:`, err.message ?? err);
    }
    // One row per Location that hears it (db/lib/scene.js) — wording is identical at every distance since a bell never muffles.
    await sceneLineAt(prisma, { locationId: place.locationId, text, signed });
  }
  return { sent, failed };
}

module.exports = { broadcastSound };
