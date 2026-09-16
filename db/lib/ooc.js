// Talking out of character. Both faces call ooc() and hand the result straight
// to deliverOoc() — bot/src/events/interactions/actions.js#handleOocCommand and
// web/app/(app)/chat/actions.js#oocHere.
//
// Deliberately much smaller than db/lib/shout.js, which this is shaped after: an
// OOC line reaches the one place it was typed in and nowhere else. No sound
// range, no distance, no muffling — none of that is happening in the fiction,
// because none of this is happening in the fiction.
//
// For the same reason no voice tag applies. A gag, a bound pair of hands and a
// mute are things done to a CHARACTER; the player behind them can still ask
// whether Mountaineering is the skill they need.

const { ambientLine } = require("./ambientLine");
const { sceneLine } = require("./scene");
const { postMessage } = require("./discordRest");
const { isScenePlaceKey, discordTargetForPlaceKey, placePairForAudit } = require("./placeKey");
const { MESSAGE_LIMIT } = require("./sayLimits");
const { checkSpeechBucket, OOC_CAPACITY, OOC_REFILL_MS } = require("./speechRateLimit");

// The AuditLog row IS the rate limit, the GM's OOC lens on /gm/turns, and the
// record — one row, the way the shout cooldown already works.
const OOC_ACTION = "ooc";

// The hard format, written exactly once. Everything a player sends through here
// comes out this shape on both faces; there is no variant and no name.
function oocBody(text) {
  return `[OOC]: ${text}`;
}

// Discord's rendering of the same body: `-#` subtext, per line.
function oocLine(text) {
  return ambientLine(oocBody(text));
}

// `character` needs { id, discordUserId }. `placeKey` is where it was typed.
// Returns { ok: true, text, body, line, placeKey } or { ok: false, error, retryAfter? }.
// Posting is deliverOoc()'s half.
async function ooc(prisma, character, text, { placeKey = null } = {}) {
  const body = String(text ?? "").trim();
  if (!body) return { ok: false, error: "Say something." };
  if (body.length > MESSAGE_LIMIT) {
    return { ok: false, error: "That was over the character limit." };
  }

  if (!character?.id) return { ok: false, error: "You don't have a living character." };
  if (!isScenePlaceKey(placeKey)) return { ok: false, error: "You can't say that here." };

  const room = await checkSpeechBucket(prisma, {
    actionType: OOC_ACTION,
    characterId: character.id,
    capacity: OOC_CAPACITY,
    refillMs: OOC_REFILL_MS,
  });
  if (!room.ok) {
    return { ok: false, retryAfter: room.retryAfter, error: "You're using OOC too much." };
  }

  // Claimed BEFORE the posting loop, like shout's: that loop is real seconds of
  // REST calls, long enough for a second send to slip past a limit claimed at
  // the end. `turnId` is set because the GM lens reads these rows per turn.
  const openTurn = await prisma.turn
    .findFirst({ where: { status: "OPEN" }, select: { id: true } })
    .catch(() => null);
  // The real place COLUMNS as well as the snapshot in `details`: the columns
  // are what /gm/audit's room filter reads, and `details` is what survives a
  // Room the zone sync later prunes (schema.prisma, AuditLog.locationId).
  const place = await placePairForAudit(prisma, placeKey).catch(() => ({ locationId: null, roomId: null }));
  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: character.discordUserId ?? "",
        actionType: OOC_ACTION,
        targetCharacterId: character.id,
        turnId: openTurn?.id ?? null,
        locationId: place.locationId ?? null,
        roomId: place.roomId ?? null,
        details: { text: body, placeKey },
      },
    })
    .catch((err) => console.error("OOC audit log failed:", err.message ?? err));

  return { ok: true, text: body, body: oocBody(body), line: oocLine(body), placeKey };
}

// Put it in front of the place it was typed in. Two halves, neither downstream
// of the other: the archive row (what /play and /archive show, the only half a
// web-only player sees) and the Discord post.
//
// NOTHING HERE MAY THROW — by the time this runs the limit is already spent, so
// a dead channel is one audience short, not a failed send.
async function deliverOoc(prisma, { placeKey, body, line } = {}) {
  if (!placeKey || !body) return;

  try {
    // No `-#` in the row: the web draws a SYSTEM row as subtext itself (CHAT.md
    // §5). `channelKind` is what lets Feed.js tell this from a smell or a gate.
    await sceneLine(prisma, { placeKey, text: body, channelKind: "ooc" });
  } catch (err) {
    console.error(`OOC row for ${placeKey} failed:`, err?.message ?? err);
  }

  try {
    const target = await discordTargetForPlaceKey(prisma, placeKey);
    const channelId = target?.threadId ?? target?.channelId ?? null;
    // parse: [] — the text is player-typed and nobody asked to be pinged by it.
    if (channelId) await postMessage(channelId, line, undefined, { parse: [] });
  } catch (err) {
    console.error(`OOC into ${placeKey} failed:`, err?.message ?? err);
  }
}

module.exports = { OOC_ACTION, oocBody, oocLine, ooc, deliverOoc };
