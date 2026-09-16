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

// What a GM may pick from, and what the DM calls each one. One list, so the
// menu, the DM and the arithmetic can never name different amounts of time.
const MUTE_DURATIONS = [
  { minutes: 5, label: "5 minutes" },
  { minutes: 15, label: "15 minutes" },
  { minutes: 180, label: "3 hours" },
  { minutes: 1440, label: "1 day" },
];

function muteDurationLabel(minutes) {
  return MUTE_DURATIONS.find((d) => d.minutes === Number(minutes))?.label ?? null;
}

// The live mute for an account, or null. `until` in the past is not a mute —
// the row lapses on its own rather than being swept (schema.prisma, OocMute),
// so this comparison IS the expiry.
async function oocMuteFor(prisma, discordUserId) {
  if (!discordUserId) return null;
  const row = await prisma.oocMute
    .findUnique({ where: { discordUserId }, select: { until: true, byDiscordUserId: true } })
    .catch(() => null);
  if (!row || row.until.getTime() <= Date.now()) return null;
  return row;
}

// The hard format, written exactly once. Everything a player sends through here
// comes out this shape on both faces; there is no variant and no name.
function oocBody(text) {
  return `[OOC]: ${text}`;
}

// THE SAME LINE, SPELLED FOR MARKDOWN — and it has to be, which is not obvious.
//
// `[OOC]: hi` at the start of a block is a Markdown LINK REFERENCE DEFINITION:
// label `OOC`, destination `hi`. A definition renders as NOTHING, so the line
// was invisible on the web while showing correctly on Discord (whose parser has
// no such syntax). It bit exactly the messages people actually send — anything
// whose text is a single word is a valid link destination, so "hi", "brb",
// "yes?" and any URL all vanished, while "hello there" survived because the
// space makes it an invalid destination and it falls back to a paragraph.
//
// Escaping the brackets renders as the literal `[OOC]: …` the format asks for.
// Only the ARCHIVE row needs it: the Discord line below must stay unescaped or
// Discord prints the backslashes. db/test/ooc.test.js pins both halves.
function oocRowBody(text) {
  return `\\[OOC\\]: ${text}`;
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

  // Muted by a GM (schema.prisma, OocMute). Ahead of the rate limit for the
  // same reason every other refusal here is: a refused send must not cost a
  // token from the bucket. Stops this and nothing else — a muted player still
  // speaks and still shouts, because those are their character's.
  if (await oocMuteFor(prisma, character.discordUserId)) {
    return { ok: false, error: "Your OOC is muted." };
  }

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
  const claimed = await prisma.auditLog
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
      select: { id: true },
    })
    .catch((err) => {
      console.error("OOC audit log failed:", err.message ?? err);
      return null;
    });

  // `auditId` rides back out so deliverOoc can staple the archive row's id to
  // it — see the backlink there. Null when the claim itself failed, which is
  // not a refusal: the words still go out.
  return {
    ok: true,
    text: body,
    placeKey,
    auditId: claimed?.id ?? null,
  };
}

// Put it in front of the place it was typed in. Two halves, neither downstream
// of the other: the archive row (what /play and /archive show, the only half a
// web-only player sees) and the Discord post.
//
// NOTHING HERE MAY THROW — by the time this runs the limit is already spent, so
// a dead channel is one audience short, not a failed send.
// `text` is the raw message; both spellings are built HERE rather than passed
// in, so a caller cannot hand the escaped one to Discord or the plain one to
// the archive (see oocRowBody).
async function deliverOoc(prisma, { placeKey, text, auditId = null } = {}) {
  if (!placeKey || !text) return;
  const line = oocLine(text);

  try {
    // No `-#` in the row: the web draws a SYSTEM row as subtext itself (CHAT.md
    // §5). `channelKind` is what lets Feed.js tell this from a smell or a gate.
    const row = await sceneLine(prisma, { placeKey, text: oocRowBody(text), channelKind: "ooc" });
    // THE BACKLINK. The GM's OOC lens opens the surrounding scene by handing
    // this id to getArchiveContext, which takes an ArchiveEntry id and nothing
    // else — and the audit row is written before any of this, so it cannot
    // carry one at creation. Stapled on here instead, into `details` (Json, so
    // no column and no migration).
    //
    // Best-effort by design, like everything else in this function: a line
    // whose backlink failed is a line the lens shows without its scene, which
    // is worth strictly more than a throw after the words have gone out.
    if (row?.id && auditId) {
      await prisma.auditLog.update({
        where: { id: auditId },
        data: { details: { text: body, placeKey, archiveEntryId: row.id } },
      });
    }
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

module.exports = {
  OOC_ACTION,
  oocRowBody,
  MUTE_DURATIONS,
  muteDurationLabel,
  oocMuteFor,
  oocBody,
  oocLine,
  ooc,
  deliverOoc,
};
