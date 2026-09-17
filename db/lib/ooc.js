// Talking out of character. Both faces call ooc() and hand the result straight
// to deliverOoc() — bot/src/events/interactions/actions.js#handleOocCommand and
// web/app/(app)/chat/actions.js#oocHere.
//
// Deliberately much smaller than db/lib/shout.js, which this is shaped after: an
// OOC line reaches the one place it was typed in and nowhere else. No sound
// range, no distance, no muffling — none of that is happening in the fiction,
// because none of this is happening in the fiction.
//
// Which is also why it reaches WIDER than a shout does. The scene predicate
// keeps /shout, /play and /roll out of a zone #summary and off a radio net,
// since none of those three is a thing you can do across a broadcast. An OOC
// line is not the character doing anything, so it goes wherever there is a
// composer to type it into — db/lib/placeKey.js#isOocPlaceKey.
//
// For the same reason no voice tag applies. A gag, a bound pair of hands and a
// mute are things done to a CHARACTER; the player behind them can still ask
// whether Mountaineering is the skill they need.

const { ambientLine } = require("./ambientLine");
const { sceneLine } = require("./scene");
const { postMessage } = require("./discordRest");
const {
  isOocPlaceKey,
  discordTargetForPlaceKey,
  placePairForAudit,
  archiveContextForPlaceKey,
} = require("./placeKey");
const { MESSAGE_LIMIT } = require("./sayLimits");
const { checkSpeechBucket, OOC_CAPACITY, OOC_REFILL_MS } = require("./speechRateLimit");
const { loadPresentedIdentity } = require("./presentedIdentity");
const { stampMentionNames, rolesToTokens, tokensToRoles, canHearPing } = require("./characterMentions");
const { sendDm } = require("./dm"); // by path, never the barrel — three exports share the name (CLAUDE.md)
const { pushToUser } = require("./webPush");

// The same cap bot/src/lib/feedOutbox.js puts on a web mention: a line naming half the room is one line, not
// twenty notifications.
const MAX_MENTION_RELAYS = 10;

// The AuditLog row IS the rate limit, the GM's OOC lens on /gm/turns, and the
// record — one row, the way the shout cooldown already works.
const OOC_ACTION = "ooc";

// What a GM may pick from, and what the DM calls each one. One list, so the
// menu, the DM and the arithmetic can never name different amounts of time.
// Lives in a leaf module — OocDesk.js is a client component and can't reach
// this file without dragging Prisma into the browser bundle.
const { MUTE_DURATIONS, muteDurationLabel } = require("./oocMuteDurations");

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

// The hard format. `[OOC (Alice): hi]` with the presented name inside the
// bracket, or the un-named `[OOC]: hi` if the caller could not resolve one
// (defensive shim — every real path threads a name).
function oocBody(text, name = null) {
  const label = name ? `[OOC (${name}): ${text}]` : `[OOC]: ${text}`;
  return label;
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
// Only the OUTER brackets need escaping — the inner `(Name)` is not part of the
// definition-shape trap. The Discord line below must stay unescaped or Discord
// prints the backslashes. db/test/ooc.test.js pins both halves.
function oocRowBody(rowContent, name = null) {
  return name
    ? `\\[OOC (${name}): ${rowContent}\\]`
    : `\\[OOC\\]: ${rowContent}`;
}

// Discord's rendering of the same body: `-#` subtext, per line.
function oocLine(text, name = null) {
  return ambientLine(oocBody(text, name));
}

// `character` needs { id, name, discordUserId } — and `name` only as the
// fallback if the identity load below fails, because the label's name is
// RE-READ off the database rather than taken from this argument. Both callers
// pass a four-column row; that is fine now, and was not before.
//
// `placeKey` is where it was typed. `source` is "DISCORD" or "WEB" — it decides whether the raw body
// carries `<@&roleId>` tokens (Discord's character-role mentions) that must
// be folded to `{char:id}` before the archive row keeps them, matching
// db/lib/say.js#prepareSpeech.
//
// Returns { ok: true, text, rowContent, name, placeKey, auditId } or
// { ok: false, error, retryAfter? }. Posting is deliverOoc()'s half.
async function ooc(prisma, character, text, { placeKey = null, source = "WEB" } = {}) {
  const body = String(text ?? "").trim();
  if (!body) return { ok: false, error: "Say something." };
  if (body.length > MESSAGE_LIMIT) {
    return { ok: false, error: "That was over the character limit." };
  }

  if (!character?.id) return { ok: false, error: "You don't have a living character." };
  // isOocPlaceKey, not isScenePlaceKey: a zone #summary and a radio net take an
  // OOC line even though neither takes a shout. See the note on the predicate.
  if (!isOocPlaceKey(placeKey)) return { ok: false, error: "You can't say that here." };

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

  // forced > concealed > own, the same rule /speak uses (db/lib/say.js:175):
  // an OOC line said from behind a hood must not out the player as the
  // character behind it, so the label reads the same identity the room sees.
  // The loader re-reads the row rather than reading `character`, which is how
  // this used to leak: both callers select four columns, none of them
  // `concealed`, so an ordinary hood resolved to the real name. It
  // log-and-continues on failure — the words still go out under the plain
  // shape.
  let name = character.name ?? null;
  const { identity } = await loadPresentedIdentity(prisma, character.id);
  if (identity?.name) name = identity.name;

  // Two spellings, differing only in mentions (db/lib/say.js#prepareSpeech).
  // `body` is what Discord posts (raw); `rowContent` is what the archive row
  // keeps, with `<@&roleId>` character-role mentions folded to `{char:id|Name}`
  // tokens so a rename never rewrites what was said.
  let rowContent = body;
  try {
    const withTokens = source === "DISCORD" ? await rolesToTokens(prisma, body) : body;
    rowContent = await stampMentionNames(prisma, withTokens);
  } catch (err) {
    console.error("OOC mention stamping failed:", err?.message ?? err);
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
    rowContent,
    name,
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
// `text` is the body as typed; `rowContent` is the archive spelling with
// character-role mentions folded to `{char:id|Name}` tokens; `name` is the
// presented identity read by ooc() and used for the label. Callers pass the
// three straight from ooc()'s return so the escaped body never reaches Discord
// and the plain one never reaches the archive. Discord's own spelling is
// derived here rather than passed in, so there is one place a mention can be
// left un-translated instead of two.
async function deliverOoc(
  prisma,
  { placeKey, text, rowContent = null, name = null, auditId = null } = {},
) {
  if (!placeKey || !text) return;
  const rowText = rowContent ?? text;
  // Discord's spelling of the same mentions. `rowText` is the face-neutral one — `{char:id|Name}` — and that is
  // the literal string Discord would have printed, braces and all, if the line went out as typed. tokensToRoles
  // is the same rewrite bot/src/lib/feedOutbox.js does on the way out of a WEB row; a Discord-origin line
  // round-trips back to the `<@&roleId>` it arrived as, so both sources leave here on one path. It also hands
  // back WHO was named, which is the relay's list.
  let discordText = text;
  let characters = [];
  try {
    const roles = await tokensToRoles(prisma, rowText);
    discordText = roles.content;
    characters = roles.characters;
  } catch (err) {
    console.error("OOC mention rewrite failed:", err?.message ?? err);
  }
  const line = oocLine(discordText, name);

  try {
    // No `-#` in the row: the web draws a SYSTEM row as subtext itself (CHAT.md
    // §5). `channelKind` is what lets Feed.js tell this from a smell or a gate.
    const row = await sceneLine(prisma, {
      placeKey,
      text: oocRowBody(rowText, name),
      channelKind: "ooc",
    });
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
        data: { details: { text, placeKey, archiveEntryId: row.id } },
      });
    }
  } catch (err) {
    console.error(`OOC row for ${placeKey} failed:`, err?.message ?? err);
  }

  try {
    const target = await discordTargetForPlaceKey(prisma, placeKey);
    const channelId = target?.threadId ?? target?.channelId ?? null;
    if (!channelId) return;
    // parse: ["users"] — a player pinging another player is exactly what OOC
    // is for. Role and @everyone/@here mentions stay blocked: character roles
    // are empty, and an @everyone from a player-typed line is a footgun.
    const posted = await postMessage(channelId, line, undefined, { parse: ["users"] });
    await relayOocMentions(prisma, { placeKey, characters, channelId, messageId: posted?.id ?? null });
  } catch (err) {
    console.error(`OOC into ${placeKey} failed:`, err?.message ?? err);
  }
}

// Somebody's name was in an OOC line. Same contract as every other relay in the game
// (bot/src/lib/mentions.js#notifyMentioned, bot/src/lib/feedOutbox.js#relayWebMentions): where and a jump link,
// never the words. It has to live here rather than in the outbox, because an OOC row is a SYSTEM row
// (db/lib/scene.js) and the outbox only carries WEB ones — which is why an OOC mention used to notify nobody at
// all even once it resolved. Character roles are held by nobody, so this DM is the whole notification.
//
// Best-effort like everything else past the rate-limit claim: a failed DM is one player un-nudged, never a
// thrown send.
async function relayOocMentions(prisma, { placeKey, characters = [], channelId, messageId }) {
  if (characters.length === 0 || !messageId) return;
  const guildId = process.env.DISCORD_GUILD_ID;
  if (!guildId) return;
  const link = `https://discord.com/channels/${guildId}/${channelId}/${messageId}`;

  const context = await archiveContextForPlaceKey(prisma, placeKey).catch(() => null);
  const place = context?.zoneName ?? (context?.channelKind ? `#${context.channelKind}` : "somewhere");
  const where = context?.threadName ? `${place} · ${context.threadName}` : place;

  for (const person of characters.slice(0, MAX_MENTION_RELAYS)) {
    if (!person?.discordUserId) continue;
    // A ping must not carry further than the place it was typed in, the same rule a spoken one follows.
    if (!(await canHearPing(prisma, person, placeKey).catch(() => false))) continue;
    await sendDm(prisma, person.discordUserId, `*You were mentioned in ${where}.*\n${link}`, {
      source: "mention",
      meta: { placeKey, where },
    }).catch((err) => console.error(`OOC couldn't relay a mention to ${person.name}:`, err?.message ?? err));
    // Browser notification for a closed /chat tab; after the DM and wrapped so a failed push never costs it.
    await pushToUser(prisma, person.discordUserId, {
      title: `${person.name} was named`,
      body: `in ${where}`,
      url: `/chat#${encodeURIComponent(placeKey)}`,
    }).catch(() => {});
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
