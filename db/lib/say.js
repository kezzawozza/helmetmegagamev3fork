// The one write path: everything a character says, on either face, goes
// through here. Split between DECIDING and WRITING, because the two faces
// need the same decision in a different order: Discord runs prepareSpeech,
// posts the webhook, then recordSpeech with the id; Web runs sayInPlace
// (prepare + record), and the outbox posts it after. Takes `prisma` as a
// parameter rather than requiring db/index.js: that would resolve to a partial exports object.

const { recordArchiveMessage } = require("./archive");
const { notifyFeed } = require("./feedNotify");
const { babble, growl, STUPID_SLUG, GHOUL_SLUG } = require("./babble");
const { blockerFor, slugsBlocking, SHOUT } = require("./incapacitation");
const { capitalizeSentences, fixContractions } = require("./textCorrection");
const { presentedIdentity } = require("./presentedIdentity");
const { loadPresentedState } = require("./examineSnapshot");
const { mayWritePlace, slowmodeMsFor } = require("./feedAccess");
const { rolesToTokens, stampMentionNames } = require("./characterMentions");
const { noteChant } = require("./riteChant");
const { chunkMessage } = require("./chunkText");
const { MESSAGE_LIMIT, MAX_SAY_PIECES, tooManyPieces } = require("./sayLimits");
const { echoSpeech } = require("./gateEcho");
const { deadchatSpeakerName } = require("./deadchat");
const { containsOoc, OOC_REFUSAL } = require("./oocGuard");


// Same number on both faces: past it, ✏️/❌ refuse, and so do ✎/✕ on the web.
const EDIT_WINDOW_MS = 5 * 60_000;

// Voice state read off the DATABASE in one query, not a passed-in tag list —
// every caller reaches speech through a different include, so trusting one led to a gate that read undefined and passed everybody.
// {tag:bound} still takes ACT not SHOUT — a hostage can yell, it just doesn't carry (see shoutMuffled below).
const BOUND_SLUG = "bound";
// Shackled muffles the same way (db/lib/bind.js#RESTRAINT_SLUGS; not required here, bind.js pulls in tag writes).
const SHACKLED_SLUG = "shackled";

const VOICE_SLUGS = [...slugsBlocking(SHOUT), STUPID_SLUG, GHOUL_SLUG, BOUND_SLUG, SHACKLED_SLUG];

async function loadVoiceState(prisma, characterId) {
  if (!characterId) return { shoutBlock: null, babbling: false, shoutMuffled: false };
  const rows = await prisma.characterTag.findMany({
    where: { characterId, quantity: { gt: 0 }, tag: { slug: { in: VOICE_SLUGS } } },
    select: { tag: { select: { slug: true, name: true } } },
  });
  return {
    shoutBlock: blockerFor(rows, SHOUT), // only /shout and the intercom read this.
    babbling: rows.some((ct) => ct.tag.slug === STUPID_SLUG),
    growling: rows.some((ct) => ct.tag.slug === GHOUL_SLUG), // a Ghoul growls (THANATI.md §4); beats babble.
    shoutMuffled: rows.some((ct) => ct.tag.slug === BOUND_SLUG || ct.tag.slug === SHACKLED_SLUG), // deliberately NOT part of shoutBlock — a refusal and a muffle are different answers.
  };
}

function lengthRefusal(_length) {
  return "That was over the character limit. Here's your message back:";
}

// Stupid wins over the autocorrect below — nothing left to capitalise once through babble.
function transformSpeech(text, { babbling, growling = false, autocorrect }) {
  const content = text ?? "";
  if (growling) return growl(content);
  if (babbling) return babble(content);
  return autocorrect ? capitalizeSentences(fixContractions(content)) : content;
}

// Web only — Discord enforces its own channel slowmode on a Discord-origin send.
async function slowmodeWaitSeconds(prisma, { characterId, placeKey }) {
  if (!characterId || !placeKey) return 0;
  if (slowmodeMsFor(placeKey) <= 0) return 0;
  const newest = await prisma.archiveEntry.findFirst({
    where: { placeKey, characterId, kind: "MESSAGE", deletedAt: null },
    orderBy: { seq: "desc" },
    select: { sentAt: true },
  });
  if (!newest?.sentAt) return 0;
  const waitMs = slowmodeMsFor(placeKey) - (Date.now() - newest.sentAt.getTime());
  return waitMs > 0 ? Math.ceil(waitMs / 1000) : 0;
}

// Returns `{ ok: true, content, identity, placeKey, source, voice }` or
// `{ ok: false, refusal, retryAfter? }`. The refusal is a finished sentence.
// Gate order matters: the place check comes before the transforms so nothing is spent on text going nowhere.
// `ghost` is the DEADCHAT seat (db/lib/deadchat.js): a dead player, speaking as their last body in
// the one room the living cannot hear. It is passed in rather than worked out here, because who is a
// ghost is decided once per request by the caller (db/lib/ghost.js) and this module answers to the
// list, not to the rule.
async function prepareSpeech(
  prisma,
  { character, placeKey, content, source = "WEB", skipSlowmode = false, ghost = false } = {},
) {
  if (!character?.id) return { ok: false, refusal: "You don't have a living character." };

  const web = source !== "DISCORD";

  // Discord's own channel permissions gate a Discord-origin send; a web send
  // has no such gate, so this is the one it gets. placesFor() decides, so the
  // gate behind it can never disagree with the composer a player is looking at (CHANNELS.md §2).
  //
  // The seat goes THROUGH, or a ghost is refused everywhere: their whole list is built by
  // ghostPlacesFor, and without these options placesFor builds a living character's one instead —
  // in which Deadchat does not appear. This one argument is the entire authorization for a ghost's
  // voice, and it stays derived from the same list the composer drew.
  if (web && !(await mayWritePlace(prisma, character, placeKey, { ghost, discordUserId: character.discordUserId }))) {
    return { ok: false, refusal: "You can't speak there." };
  }

  // A ghost speaks with no body, so nothing a body could do to a voice applies: no babble from
  // {tag:stupid}, no growl from a Ghoul. The corpse is still wearing its tags and would otherwise
  // carry them into a room where none of it is happening.
  const voice = ghost
    ? { babbling: false, growling: false }
    : await loadVoiceState(prisma, character.id);

  const raw = content ?? "";
  if (!raw.trim()) return { ok: false, refusal: "There wasn't anything in your message." };
  if (raw.length > MESSAGE_LIMIT) return { ok: false, refusal: lengthRefusal(raw.length) };

  // Speech is in character; `(`, `[` and the bare word "ooc" say it was not
  // meant to be (db/lib/oocGuard.js). Refused outright rather than posted and
  // tidied later, and handed back to the player in a DM by the caller —
  // `oocRejected` is how they know to send it. /ooc is where it goes instead.
  //
  // Never for a ghost: Deadchat is out of character by design (CLAUDE.md,
  // "Death, ghosts and Deadchat"), so filtering it would be backwards.
  if (!ghost && containsOoc(raw)) {
    return { ok: false, refusal: OOC_REFUSAL, oocRejected: true, original: raw };
  }

  // `skipSlowmode` is for pieces AFTER the first of a split send — otherwise piece 1 would refuse piece 2, leaving half a message posted.
  if (web && !skipSlowmode) {
    const wait = await slowmodeWaitSeconds(prisma, { characterId: character.id, placeKey });
    if (wait > 0) {
      return { ok: false, refusal: `Wait ${wait}s before speaking again.`, retryAfter: wait };
    }
  }

  const config = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: { tupperAutocorrectEnabled: true },
  });
  const text = transformSpeech(raw, {
    babbling: voice.babbling,
    growling: voice.growling,
    autocorrect: Boolean(config?.tupperAutocorrectEnabled),
  });

  // Two spellings, differing only in mentions: `content` is what DISCORD is
  // handed (raw `<@&roleId>`); `rowContent` is what the ARCHIVE stores, folded
  // into `{char:<id>}` (PROXYING.md §6). Then every mention is stamped with
  // the name its subject presents now, unconditionally — a server action is a
  // public endpoint and a posted name is a claim, not a fact.
  const rowContent = await stampMentionNames(
    prisma,
    source === "DISCORD" ? await rolesToTokens(prisma, text) : text,
  );

  // forced > concealed > own (db/lib/presentedIdentity.js), read off the
  // character, never off the caller. One query answers name, face, AND what
  // the room could SEE (db/lib/examineSnapshot.js), so they cannot disagree.
  //
  // None of that applies to a ghost. Deadchat is out-of-character, so a hood or a forced name the
  // corpse is still wearing would be answering a question nobody asked — the room wants to know who
  // you actually were. The name is "Solomon Baker (Pub Fries)"; `alias: null` is load-bearing, since
  // recordSpeech gates presentedAvatarPath on it and feedRowShape hoods a row that carries one, and
  // a hooded row is the opposite of what this room is for. A null avatarPath then resolves live off
  // the DEAD character's own row, which is how they keep the face they had in game.
  let presentedState = null;
  let identity;
  if (ghost) {
    identity = {
      name: await deadchatSpeakerName(character),
      avatarPath: null,
      alias: null,
      concealed: false,
      forced: false,
    };
  } else {
    const loaded = await loadPresentedState(prisma, character.id);
    presentedState = loaded.state;
    identity = presentedIdentity(character, { forcedName: loaded.forcedName, concealment: loaded.concealment });
  }

  return {
    ok: true,
    character,
    content: text,
    rowContent,
    identity,
    presentedState,
    placeKey: placeKey ?? null,
    source,
    voice,
    ghost,
  };
}

// The write half. `prepared` is what prepareSpeech returned; everything else
// is the Discord context the caller has and this module does not.
async function recordSpeech(
  prisma,
  prepared,
  {
    discordMessageId = null,
    discordChannelId = null,
    zoneId = null,
    zoneName = null,
    channelKind = null,
    threadName = null,
    content = null,
    clientId = null,
    sentAt = null,
    // The proxy's two extras: `sourceDiscordMessageId` (unique index, so a
    // redelivered event can't post twice) and `rethrow` (lets the proxy see that collision).
    sourceDiscordMessageId = null,
    rethrow = false,
  } = {},
) {
  if (!prepared?.ok) return null;
  const row = await recordArchiveMessage(prisma, {
    clientId,
    sentAt, // when actually SAID, for messageCatchUp.js recovering a message typed while the bot was down.
    content: content ?? prepared.rowContent ?? prepared.content, // the proxy's attachment placeholders, if any; else the ROW's spelling.
    // A ghost's row is stamped with the COMPOSED name — "Solomon Baker (Pub Fries)" — frozen the way
    // every other identity column here is frozen, so an account rename never rewrites what the room
    // read. characterId stays the dead character's, which is what keeps the avatar, the grouping and
    // the five-minute edit window all working with no new rule.
    character: prepared.ghost ? { ...prepared.character, name: prepared.identity.name } : prepared.character,
    concealedAlias: prepared.identity?.alias ?? null,
    // Frozen so a live lookup never unmasks an old line. Gated on `alias`, not
    // unconditional, since the own-face path carries a cache-buster.
    presentedAvatarPath: prepared.identity?.alias ? (prepared.identity.avatarPath ?? null) : null,
    presentedState: prepared.presentedState ?? null, // what the room could SEE, built above by prepareSpeech.
    placeKey: prepared.placeKey,
    source: prepared.source,
    discordMessageId,
    sourceDiscordMessageId,
    discordChannelId,
    zoneId,
    zoneName,
    channelKind,
    threadName,
  }, { rethrow });
  // The Thanati listen to every room (db/lib/riteChant.js). Not awaited: a chant must not slow or fail the message it rode in on.
  // Never for a ghost: the cult listens to ROOMS, and Deadchat is not one — a word said there is
  // said nowhere in the world, so it can neither carry a rite nor be overheard by one.
  if (row && !prepared.ghost) void noteChant(prisma, { row, character: prepared.character });
  // Heard through the bars of a modular gate (db/lib/gateEcho.js), but not for a message recovered late (sentAt set).
  // A ghost is behind no gate either, and their corpse's stale locationId would aim the echo at a
  // Location they are not standing in.
  if (row && !sentAt && !prepared.ghost) {
    void echoSpeech(prisma, prepared, row).catch((err) => console.error("Gate echo failed:", err.message ?? err));
  }
  return row;
}

// The web's order: decide, then write, and let the outbox put it on Discord.
async function sayInPlace(prisma, { character, placeKey, content, source = "WEB", ghost = false, ...context } = {}) {
  const prepared = await prepareSpeech(prisma, { character, placeKey, content, source, ghost });
  if (!prepared.ok) return prepared;
  const row = await recordSpeech(prisma, prepared, context);
  if (!row) return { ok: false, refusal: "That didn't get written down. Try again." };
  return { ok: true, row, prepared };
}

// One typed message, sent as SEVERAL, up to MAX_SAY_PIECES. WEB ONLY —
// Discord's own client stops a player at 2000 before the bot ever sees it.
// Splitter is chunkMessage (also postAsCharacter's): blank lines first, then
// lines, hard-slicing only a line itself over the cap.
// Returns { ok: true, rows, pieces } or { ok: false, refusal, retryAfter? }.
async function sayInPieces(
  prisma,
  { character, placeKey, content, source = "WEB", ghost = false, maxPieces = MAX_SAY_PIECES, clientId = null, ...context } = {},
) {
  const raw = content ?? "";
  if (!raw.trim()) return { ok: false, refusal: "There wasn't anything in your message." };

  // Checked over the WHOLE text, before it is split: a marker in the third
  // piece would otherwise refuse only that piece, leaving the first two
  // standing in the room (see partlySent below).
  if (!ghost && containsOoc(raw)) {
    return { ok: false, refusal: OOC_REFUSAL, oocRejected: true, original: raw };
  }

  const pieces = chunkMessage(raw);
  if (pieces.length === 0) return { ok: false, refusal: "There wasn't anything in your message." };
  if (pieces.length > maxPieces) return { ok: false, refusal: tooManyPieces(pieces.length) };

  const rows = [];
  for (const [index, piece] of pieces.entries()) {
    const prepared = await prepareSpeech(prisma, {
      character,
      placeKey,
      content: piece,
      source,
      ghost,
      skipSlowmode: index > 0, // checked once, on the first piece. See prepareSpeech.
    });
    if (!prepared.ok) {
      if (rows.length === 0) return prepared;
      // Half of it is already in the room; say which half landed.
      return { ok: false, refusal: partlySent(rows.length, pieces.length), rows, pieces: rows.length };
    }

    const row = await recordSpeech(prisma, prepared, {
      ...context,
      clientId: index === 0 ? clientId : null, // FIRST piece only, or three rows would fight over one twin.
    });
    if (!row) {
      if (rows.length === 0) return { ok: false, refusal: "That didn't get written down. Try again." };
      return { ok: false, refusal: partlySent(rows.length, pieces.length), rows, pieces: rows.length };
    }
    rows.push(row);
  }

  return { ok: true, rows, pieces: rows.length };
}

function partlySent(sent, total) {
  return `Only ${sent} of ${total} messages went out. The rest didn't send — you'll need to retype them.`;
}

// ---- Edits and deletes -----------------------------------------------------
// The ROW is the source of truth for both, on both faces — bot/src/lib/feedOutbox.js is the only thing that touches the Discord message.

// A superset of archive.js#FEED_ROW_SELECT, plus the three columns only the checks here need.
const EDITABLE_SELECT = {
  id: true,
  seq: true,
  placeKey: true,
  characterId: true,
  characterName: true,
  concealedAlias: true,
  presentedAvatarPath: true,
  content: true,
  sentAt: true,
  source: true,
  editedAt: true,
  deletedAt: true,
  kind: true,
  discordMessageId: true,
};

function pastWindow(row) {
  return Date.now() - new Date(row.sentAt).getTime() > EDIT_WINDOW_MS;
}

const WINDOW_REFUSAL = "You can't edit that any more.";
const GONE_REFUSAL = "That message is gone.";
const NOT_YOURS_REFUSAL = "That isn't yours to change.";

// `gm: true` skips the owner and window checks — a GM taking a line down is moderation, not a retraction.
async function loadEditable(prisma, { characterId, seq, gm = false }) {
  if (seq === null || seq === undefined) return { ok: false, refusal: GONE_REFUSAL };
  let key;
  try {
    key = BigInt(seq);
  } catch {
    return { ok: false, refusal: GONE_REFUSAL };
  }

  const row = await prisma.archiveEntry.findUnique({ where: { seq: key }, select: EDITABLE_SELECT });
  if (!row || row.kind !== "MESSAGE" || row.deletedAt) return { ok: false, refusal: GONE_REFUSAL };
  if (gm) return { ok: true, row };
  if (!row.characterId || row.characterId !== characterId) return { ok: false, refusal: NOT_YOURS_REFUSAL };
  if (pastWindow(row)) return { ok: false, refusal: WINDOW_REFUSAL };
  return { ok: true, row };
}

// Re-runs the transforms, since an edit is fresh writing. Does NOT re-freeze
// presentedState — nobody in the fiction re-observes anybody over a fixed
// typo, and re-snapshotting would make the edit window a laundering device (robe up, edit the old line, leak again).
async function editSpeech(prisma, { characterId, seq, content, gm = false } = {}) {
  const found = await loadEditable(prisma, { characterId, seq, gm });
  if (!found.ok) return found;
  const row = found.row;

  const raw = content ?? "";
  if (!raw.trim()) return { ok: false, refusal: "There wasn't anything in your message." };
  if (raw.length > MESSAGE_LIMIT) return { ok: false, refusal: lengthRefusal(raw.length) };

  const [voice, config] = await Promise.all([
    loadVoiceState(prisma, row.characterId),
    prisma.gameConfig.findUnique({ where: { id: 1 }, select: { tupperAutocorrectEnabled: true } }),
  ]);
  const transformed = transformSpeech(raw, {
    babbling: voice.babbling,
    autocorrect: Boolean(config?.tupperAutocorrectEnabled),
  });
  // The stamp re-runs over the whole edited text, so a mention ADDED by the
  // edit freezes the name as it is now — trading a kept mention's re-date for
  // avoiding a diff of two strings to find which tokens are old.
  const text = await stampMentionNames(prisma, await rolesToTokens(prisma, transformed));

  const updated = await prisma.archiveEntry.update({
    where: { id: row.id },
    data: { content: text, editedAt: new Date() },
    select: EDITABLE_SELECT,
  });

  if (updated.placeKey) {
    await notifyFeed(prisma, { seq: updated.seq, placeKey: updated.placeKey, op: "edit" });
  }
  return { ok: true, row: updated };
}

// Soft, everywhere — the row stays so the outbox has something to delete; /archive and /chat both filter on deletedAt.
async function deleteSpeech(prisma, { characterId, seq, gm = false } = {}) {
  const found = await loadEditable(prisma, { characterId, seq, gm });
  if (!found.ok) return found;

  const updated = await prisma.archiveEntry.update({
    where: { id: found.row.id },
    data: { deletedAt: new Date() },
    select: EDITABLE_SELECT,
  });

  if (updated.placeKey) {
    await notifyFeed(prisma, { seq: updated.seq, placeKey: updated.placeKey, op: "delete" });
  }
  return { ok: true, row: updated };
}

module.exports = {
  MESSAGE_LIMIT,
  EDIT_WINDOW_MS,
  WINDOW_REFUSAL,
  loadVoiceState,
  transformSpeech,
  prepareSpeech,
  recordSpeech,
  sayInPlace,
  sayInPieces,
  editSpeech,
  deleteSpeech,
};
