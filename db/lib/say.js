// The one write path: everything a character says, on either face, goes
// through here.
//
// Before phase 1 there were three of them. bot/src/lib/proxy.js ran the
// speech gate, the babble pass and the autocorrect pass inside the webhook
// poster; the Speak modal ran a second copy of the gate and then leaned on
// that one; and the web's say route ran neither, so {tag:stupid} garbled a
// Discord message and left a web one perfectly articulate. Three answers to
// one question is two too many.
//
// The split is between DECIDING and WRITING, because the two faces need the
// same decision in a different order:
//
//   Discord — prepareSpeech, post the webhook, recordSpeech with the id.
//   Web     — sayInPlace (prepare + record), and the outbox posts it after.
//
// Takes `prisma` as a parameter rather than requiring db/index.js, same
// reason as archive.js and dm.js: db/index.js imports this module, so
// requiring it back would resolve to a partial exports object.

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
// The numbers and the refusal wording, in a module with no requires so the
// composer can read them too (db/lib/sayLimits.js).
const { chunkMessage } = require("./chunkText");
const { MESSAGE_LIMIT, MAX_SAY_PIECES, tooManyPieces } = require("./sayLimits");
const { echoSpeech } = require("./gateEcho");


// How long a message stays yours to change. Bascinet's call, and the same
// number on both faces: past it, ✏️ and ❌ refuse and so do the web's ✎ and ✕.
const EDIT_WINDOW_MS = 5 * 60_000;

// Everything about a character's voice, read off the DATABASE in one query
// rather than off a passed-in tag list.
//
// This was bot/src/lib/proxy.js#loadVoiceState, and the reason it reads the
// sheet is worth keeping: every caller reaches speech through a different
// include. messageCreate.js loads a FILTERED tag list for identity and does
// not even select `slug`, and the Speak modal's findAliveCharacter loads no
// tags at all — so a gate that trusted the caller's include read undefined
// and passed everybody.
// Tied up. Not in the RESTRICTIONS table above it in incapacitation.js and
// deliberately not going in: {tag:bound} still takes ACT and not SHOUT, so a
// hostage can still yell. It only stops the yell CARRYING — see shoutMuffled
// below.
const BOUND_SLUG = "bound";

// SHOUT is the superset — everything that takes the ordinary voice takes the
// yell too (db/lib/incapacitation.js), plus {tag:mute}, which takes only the
// yell. One query still answers all of these.
const VOICE_SLUGS = [...slugsBlocking(SHOUT), STUPID_SLUG, GHOUL_SLUG, BOUND_SLUG];

async function loadVoiceState(prisma, characterId) {
  if (!characterId) return { shoutBlock: null, babbling: false, shoutMuffled: false };
  const rows = await prisma.characterTag.findMany({
    where: { characterId, quantity: { gt: 0 }, tag: { slug: { in: VOICE_SLUGS } } },
    select: { tag: { select: { slug: true, name: true } } },
  });
  return {
    // Nothing takes ordinary speech any more (db/lib/incapacitation.js —
    // SPEAK is a deliberately empty column). Only /shout reads this one
    // (db/lib/shout.js), plus the two intercom call sites, which are gated
    // as a loudspeaker rather than a conversation.
    shoutBlock: blockerFor(rows, SHOUT),
    babbling: rows.some((ct) => ct.tag.slug === STUPID_SLUG),
    // A Ghoul growls (docs/systemdocs/THANATI.md §4). Growl beats babble: a
    // risen Stupid is a Ghoul first.
    growling: rows.some((ct) => ct.tag.slug === GHOUL_SLUG),
    // Bound: the yell happens, it just does not travel. Read only by
    // db/lib/shout.js, and deliberately NOT part of `shoutBlock` — a refusal
    // and a muffle are different answers, and being tied up is still not a
    // reason to be told you may not shout.
    shoutMuffled: rows.some((ct) => ct.tag.slug === BOUND_SLUG),
  };
}

function lengthRefusal(_length) {
  return "That was over the character limit. Here's your message back:";
}

// The two transforms a proxied message has always had. Stupid reads off the
// SPEAKER rather than off GameConfig and it wins over the autocorrect below —
// there is nothing left to capitalise once it has been through babble.
function transformSpeech(text, { babbling, growling = false, autocorrect }) {
  const content = text ?? "";
  if (growling) return growl(content);
  if (babbling) return babble(content);
  return autocorrect ? capitalizeSentences(fixContractions(content)) : content;
}

// Slowmode, for the web only. Discord enforces its own channel slowmode on a
// Discord-origin send, and running a second one here would refuse a message
// Discord had already let through.
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

// Everything that decides whether these words are said, and in what form.
//
// Returns `{ ok: true, content, identity, placeKey, source, voice }` or
// `{ ok: false, refusal, retryAfter? }`. The refusal is a finished sentence:
// the Discord path DMs it back with the player's text, the web path returns
// it as `{ error }`.
//
// Gate order matters: the place check comes before the transforms so nothing
// is spent on text that is not going anywhere. There is no voice-block gate
// here any more — nothing takes ordinary speech (db/lib/incapacitation.js) —
// `loadVoiceState` below is read only for the babble/growl transforms and the
// slowmode check that follows.
async function prepareSpeech(prisma, { character, placeKey, content, source = "WEB", skipSlowmode = false } = {}) {
  if (!character?.id) return { ok: false, refusal: "You don't have a living character." };

  const web = source !== "DISCORD";

  // Where. Discord's own channel permissions are the gate for a Discord-origin
  // send — the player could not have typed it otherwise — and re-deciding that
  // here would only mean refusing a message Discord already accepted. A web
  // send has no such gate in front of it, so this is the one it gets.
  // placesFor() is what decides, so the composer a player is looking at and
  // the gate behind it can never disagree. It also decides that a Location
  // channel is scenery rather than speech (CHANNELS.md §2), which is why this
  // refusal now has a second wording behind it.
  if (web && !(await mayWritePlace(prisma, character, placeKey))) {
    return { ok: false, refusal: "You can't speak there." };
  }

  const voice = await loadVoiceState(prisma, character.id);

  const raw = content ?? "";
  if (!raw.trim()) return { ok: false, refusal: "There wasn't anything in your message." };
  if (raw.length > MESSAGE_LIMIT) return { ok: false, refusal: lengthRefusal(raw.length) };

  // `skipSlowmode` is for the pieces AFTER the first of a split send, and
  // nothing else. Slowmode is measured against the newest row this character
  // wrote here, so piece 1 would otherwise refuse piece 2 and leave half a
  // message posted. It only bites in the zone summary — PLACE_SLOWMODE_MS is
  // 0 (db/lib/feedAccess.js) — but half a message is the one outcome worse
  // than a clean refusal, so the split checks it once and then says so.
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

  // Two spellings of the same sentence, and the difference is only ever a
  // mention. `content` is what DISCORD is handed — a Discord-origin send has
  // to go back out with the `<@&roleId>` the player typed, or the chip they
  // meant becomes literal text. `rowContent` is what the ARCHIVE stores, with
  // every character-role mention folded into the face-neutral `{char:<id>}`
  // the web renders and the outbox translates back (PROXYING.md §6,
  // db/lib/characterMentions.js). A web send needs no translation in this
  // direction: its composer already writes tokens.
  //
  // Then every mention is stamped with the name its subject is presenting now,
  // so the row freezes who it named the same way it already freezes who said
  // it. Both faces, unconditionally: the web composer writes a name in as it
  // inserts the chip and this OVERWRITES it, because a server action is a
  // public endpoint and a posted name is a claim, not a fact.
  const rowContent = await stampMentionNames(
    prisma,
    source === "DISCORD" ? await rolesToTokens(prisma, text) : text,
  );

  // Which name and face this goes out under: forced > concealed > own
  // (db/lib/presentedIdentity.js). Read off the character, never off the
  // caller — concealment is standing state and a caller's opinion of it would
  // be a second answer to a settled question.
  //
  // One query where there used to be two. loadPresentedState's select is a
  // superset of what loadForcedName and loadConcealment each fetched, and it
  // hands back the third frozen column besides: what the room could SEE of the
  // speaker, which the row keeps beside the name and the face
  // (db/lib/examineSnapshot.js). Same rows answer all three, so they cannot
  // disagree about what somebody was holding.
  const { state: presentedState, forcedName, concealment } = await loadPresentedState(prisma, character.id);
  const identity = presentedIdentity(character, { forcedName, concealment });

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
    // The proxy's two extras. `sourceDiscordMessageId` is the player's own
    // message, claimed on a unique index so a redelivered event cannot post
    // twice; `rethrow` is how the proxy gets to see that collision instead of
    // having it swallowed. Both null/false everywhere else.
    sourceDiscordMessageId = null,
    rethrow = false,
  } = {},
) {
  if (!prepared?.ok) return null;
  const row = await recordArchiveMessage(prisma, {
    // The web composer's token for the copy it has already drawn. Null on the
    // Discord path, which has no optimistic row to reconcile.
    clientId,
    // When this was actually SAID, for a caller that is not writing it live.
    // bot/src/lib/messageCatchUp.js recovers messages typed while the bot was
    // down, and the whole point of the row is that it carries the moment the
    // player typed it rather than the moment the bot woke up. Null everywhere
    // else, and recordArchiveMessage falls back to now.
    sentAt,
    // A caller that appended something to the prepared text (the proxy adds
    // its attachment placeholders) hands the finished string back here.
    // Otherwise the ROW's spelling is what is stored, not Discord's.
    content: content ?? prepared.rowContent ?? prepared.content,
    character: prepared.character,
    concealedAlias: prepared.identity?.alias ?? null,
    // The face that went with the name, frozen for the same reason: a live
    // lookup would unmask every old line the moment the mask came off. Gated
    // on `alias` rather than written unconditionally, because the own-face
    // path carries a ?v=<updatedAt> cache-buster and freezing one would pin a
    // stale portrait forever. Null is how "their own face" is recorded.
    presentedAvatarPath: prepared.identity?.alias ? (prepared.identity.avatarPath ?? null) : null,
    // And what the room could SEE of them — the third frozen column, built
    // above by prepareSpeech.
    presentedState: prepared.presentedState ?? null,
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
  // The Thanati listen to every room (db/lib/riteChant.js). Not awaited: a
  // chant that counts writes a row or two of its own, and none of that may
  // slow or fail the message it rode in on.
  if (row) void noteChant(prisma, { row, character: prepared.character });
  // Heard through the bars of a modular gate (db/lib/gateEcho.js). Not for a
  // message recovered late by messageCatchUp.js, the only caller with sentAt.
  if (row && !sentAt) {
    void echoSpeech(prisma, prepared, row).catch((err) => console.error("Gate echo failed:", err.message ?? err));
  }
  return row;
}

// The web's order: decide, then write, and let the outbox put it on Discord.
async function sayInPlace(prisma, { character, placeKey, content, source = "WEB", ...context } = {}) {
  const prepared = await prepareSpeech(prisma, { character, placeKey, content, source });
  if (!prepared.ok) return prepared;
  const row = await recordSpeech(prisma, prepared, context);
  if (!row) return { ok: false, refusal: "That didn't get written down. Try again." };
  return { ok: true, row, prepared };
}

// The web's other order: one typed message, sent as SEVERAL.
//
// A goods list over 2000 characters used to be refused outright, and the
// refusal was the first mention a player got that a limit existed at all
// (docs/systemdocs/CHAT.md). It splits now instead — up to MAX_SAY_PIECES
// messages, and only past that is anything refused.
//
// WEB ONLY, on purpose. Discord's own client stops a player at 2000 before
// the bot ever sees the message, so there is nothing on that side to split.
//
// The splitter is chunkMessage, the one postAsCharacter already uses: it
// breaks on blank lines first, then on lines, and hard-slices only a single
// line that is itself over the cap. A list splits between items rather than
// through one, and it costs no new code.
//
// Returns { ok: true, rows, pieces } or { ok: false, refusal, retryAfter? }.
async function sayInPieces(
  prisma,
  { character, placeKey, content, source = "WEB", maxPieces = MAX_SAY_PIECES, clientId = null, ...context } = {},
) {
  const raw = content ?? "";
  if (!raw.trim()) return { ok: false, refusal: "There wasn't anything in your message." };

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
      // Checked once, on the first piece. See prepareSpeech.
      skipSlowmode: index > 0,
    });
    if (!prepared.ok) {
      // Nothing written yet, so this is an ordinary refusal — the place gate,
      // slowmode, an empty message.
      if (rows.length === 0) return prepared;
      // Half of it is already in the room. Every gate passed to get here, so
      // only the write itself can have failed; say which half landed rather
      // than pretending the whole send did.
      return { ok: false, refusal: partlySent(rows.length, pieces.length), rows, pieces: rows.length };
    }

    const row = await recordSpeech(prisma, prepared, {
      ...context,
      // The clientId rides on the FIRST piece only. feedStore.js swaps a
      // pending row for the confirmed row carrying its clientId, and three
      // rows claiming one twin would fight over it — the rest arrive as
      // ordinary new rows on the stream.
      clientId: index === 0 ? clientId : null,
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
//
// The ROW is the source of truth for both, on both faces. A player pressing
// ✏️ in Discord and a player pressing ✎ on /chat now do the same thing: they
// change the row and notify, and bot/src/lib/feedOutbox.js is the only thing
// that touches the Discord message. That is what retires the in-memory
// recentProxies map, and with it the restart amnesia that made an hour-old
// message inert to every reaction.

// A superset of archive.js#FEED_ROW_SELECT, so what comes back out of an edit
// is already the wire row the client replaces by seq — plus the three columns
// only the checks here need.
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

// Shared by both verbs: find the row, and answer whether this caller may
// touch it. `gm: true` skips the owner and window checks — a GM taking a line
// down is moderation, not a retraction, and phase 3's desk is the surface for
// it.
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

// Re-run the transforms, because an edit is a fresh piece of writing: a
// player who went Stupid between saying it and fixing it babbles now.
//
// It does NOT re-freeze presentedState, and that is not an oversight. The
// WORDS are fresh writing; what the room saw is not — nobody in the fiction
// re-observes anybody because a typo got fixed. Re-snapshotting would also
// make the five-minute window a laundering device (robe up, edit the old line,
// leak again), and a GM edit is exempt from that window entirely, so it would
// rewrite what a room saw days ago.
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
  // The row's spelling, both ways round. A ✏️ on Discord can add a mention the
  // row has to store as a token; a ✎ on the web already wrote one. Running it
  // unconditionally is safe because rolesToTokens only ever touches a role id
  // that IS a character's name token.
  //
  // The stamp re-runs over the whole edited text, so a mention ADDED by an
  // edit freezes the name as it is now. That does re-date a mention the edit
  // kept, which is the right trade: an edit is fresh writing, the window for
  // one is five minutes (EDIT_WINDOW_MS), and the alternative is diffing two
  // strings to decide which tokens are old — a great deal of machinery to
  // preserve a name that is five minutes stale at worst.
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

// Soft, everywhere. The row stays so a client holding it can reconcile, and
// so the outbox has something to read when it goes to delete the Discord
// message; /archive and /chat both filter on deletedAt.
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
