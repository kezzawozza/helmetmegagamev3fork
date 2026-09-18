// Writes the game transcript (ArchiveEntry), the store behind /archive. Rows are
// recorded at SEND time, not reconstructed later, so the character and turn are told outright instead of guessed (a rename or a timestamp-vs-Turn.gameDate comparison would misattribute them).
// Takes `prisma` as a parameter rather than require("../index") — db/index.js imports this module, so requiring back would resolve to a partial (prisma-less) exports object. Deliberately NOT spread into the @lifeweb/db barrel — require it by path.

const { Prisma } = require("@prisma/client");
const { notifyFeed } = require("./feedNotify");
const { hoodToken } = require("./whosHere");
const { loadPresentedState } = require("./examineSnapshot");

// The columns the live feed needs off a row, and nothing else — kept beside feedRowShape below so the two never drift.
const FEED_ROW_SELECT = {
  seq: true,
  placeKey: true,
  characterId: true,
  characterName: true,
  concealedAlias: true,
  presentedAvatarPath: true,
  content: true,
  sentAt: true,
  source: true,
  // Carries no identity, just "scene"/"intercom"/etc — safe on every row,
  // hooded or not. What SystemRow (web/app/(app)/chat/Feed.js) reads to draw
  // the intercom bold and full size instead of as ordinary muted scenery.
  channelKind: true,
  editedAt: true,
  deletedAt: true,
};

// One archived row as the wire shape /chat and /api/feed speak.
// `name`/`avatarPath` are the PRESENTED identity — alias/frozen face if concealed, else null so the client asks /api/avatar. `discordUserId` is never sent. A row with an alias and no path predates the column and gets `unknownFace` + the question-mark plate rather than a guess — the only wrong direction here is exposing somebody the room couldn't see.
// `characterId` is WITHHELD on a hooded row — the load-bearing line in this file. Shipping it on every row would let a browser match a hooded line to a named one by id and read the hood straight off, the exact unmasking db/lib/whosHere.js#hoodToken exists to prevent. `speakerKey` replaces it: the same HMAC that file mints, so consecutive hooded lines still group and a player can still recognise their OWN hooded lines (the page compares its own key) — the browser can only correlate hood-with-hood, never hood-with-name.
// Withheld per ROW, not per reader — feedHub.js fans one row out to every watcher of a place, so a per-reader decision here would be decided for whoever happened to be first; ownership stays a client-side hint, every edit/delete re-resolves the actor server-side (say.js). `avatarVersion` (a cache-buster off the speaker's updatedAt) is withheld the same way — another id two rows could be matched on. `seq` is a BigInt on the row and a STRING here: JSON.stringify throws on a BigInt, and a Number would lose precision at the far end of the range.
function feedRowShape(row, extra = {}) {
  if (!row) return null;
  // Any row said under a name that isn't their own (a hood, or a forced name like Apex Form's Beast) wears a face that isn't theirs (presentedIdentity.js), so both withhold the id behind it.
  const hooded = Boolean(row.concealedAlias);
  // Pulled out of `extra`, or a caller that knows the speaker's updatedAt (withAvatarVersions, feedHub) would put the cache-buster back on a hooded row after this took it off.
  const { avatarVersion, ...rest } = extra;
  return {
    seq: String(row.seq),
    placeKey: row.placeKey ?? null,
    characterId: hooded ? null : (row.characterId ?? null),
    speakerKey: hooded && row.characterId ? hoodToken(row.characterId) : null,
    name: row.concealedAlias ?? row.characterName ?? null,
    alias: row.concealedAlias ?? null,
    avatarPath: row.presentedAvatarPath ?? null,
    unknownFace: hooded && !row.presentedAvatarPath,
    avatarVersion: hooded ? null : (avatarVersion ?? row.avatarVersion ?? (row.sentAt ? new Date(row.sentAt).getTime() : null)),
    content: row.content ?? "",
    sentAt: row.sentAt ? new Date(row.sentAt).toISOString() : null,
    source: row.source ?? "DISCORD",
    channelKind: row.channelKind ?? null,
    editedAt: row.editedAt ? new Date(row.editedAt).toISOString() : null,
    deletedAt: row.deletedAt ? new Date(row.deletedAt).toISOString() : null,
    ...rest,
  };
}

// A batch of rows shaped with ONE `?v=` per character — feedRowShape falls back to
// the row's own sentAt when nobody hands it an avatarVersion, a different number per row, so a page asked /api/avatar/<id> once per line and a reader watched a portrait blink down the scene. Same answer as the live NOTIFY path (feedHub.js#avatarVersionFor) for the three surfaces that render a batch: /chat's first paint, the stream's catch-up, /api/feed/history.
// ArchiveEntry.characterId is a SNAPSHOT string, not a foreign key, so a row whose character has since been deleted just misses the map and keeps the old fallback.
async function withAvatarVersions(prisma, rows, extra = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const ids = [...new Set(list.map((row) => row?.characterId).filter(Boolean))];
  const versions = new Map();
  if (ids.length > 0) {
    const characters = await prisma.character
      .findMany({ where: { id: { in: ids } }, select: { id: true, updatedAt: true } })
      .catch(() => []);
    for (const c of characters) versions.set(c.id, c.updatedAt?.getTime?.() ?? null);
  }
  return list.map((row) => {
    const version = row?.characterId ? versions.get(row.characterId) : undefined;
    return feedRowShape(row, version === undefined ? extra : { ...extra, avatarVersion: version });
  });
}

// --------------------------------------------------------------- /archive

// The columns the transcript reads, on top of the feed's — `id` is the React key/citation anchor; the rest is what the page groups and styles by (docs/systemdocs/ARCHIVE.md §5).
const ARCHIVE_ROW_SELECT = {
  ...FEED_ROW_SELECT,
  id: true,
  kind: true,
  turnNumber: true,
  turnPhase: true,
  zoneName: true,
  threadName: true,
  channelKind: true,
};

// A page of transcript rows, shaped for the browser. Goes through feedRowShape rather
// than around it — the archive names the character behind every hood but must still not hand the browser the pieces to correlate a hooded line with a named one by id; feedRowShape withholds `characterId` and substitutes `speakerKey`, and re-shaping by hand would quietly undo that. The archive DOES render `alias (Real Name)` where the feed shows only the alias — deliberate, and why the page stays shut until the game is over — so `realName` rides along explicitly rather than being smuggled into `name`. One `?v=` per character, not per row (see withAvatarVersions).
async function archiveRowsShape(prisma, rows) {
  const list = Array.isArray(rows) ? rows : [];
  const ids = [...new Set(list.map((row) => row?.characterId).filter(Boolean))];
  const versions = new Map();
  if (ids.length > 0) {
    const characters = await prisma.character
      .findMany({ where: { id: { in: ids } }, select: { id: true, updatedAt: true } })
      .catch(() => []);
    for (const c of characters) versions.set(c.id, c.updatedAt?.getTime?.() ?? null);
  }
  return list.map((row) => {
    const version = row?.characterId ? versions.get(row.characterId) : undefined;
    return feedRowShape(row, {
      ...(version === undefined ? {} : { avatarVersion: version }),
      id: row.id,
      kind: row.kind,
      turnNumber: row.turnNumber ?? null,
      turnPhase: row.turnPhase ?? null,
      zoneName: row.zoneName ?? null,
      threadName: row.threadName ?? null,
      channelKind: row.channelKind ?? null,
      realName: row.characterName ?? null,
    });
  });
}

// Every write here is best-effort and swallows its own failure — a transcript row is never worth breaking a player's message over, and the proxy calls this inline with the send. Failures are logged, not thrown.
async function safely(label, fn) {
  try {
    return await fn();
  } catch (err) {
    console.error(`Archive ${label} failed:`, err);
    return null;
  }
}

// Which game a row belongs to: GameState.gameId, memoised for half a minute so a
// message costs no extra round trip. The wipe swaps the id; a stale memo for up to thirty seconds after a wipe stamps a row nobody will read, which is fine — the wipe also drops every character who could have written one.
const GAME_ID_TTL_MS = 30 * 1000;
let gameIdMemo = { id: null, at: 0 };

async function currentGameId(prisma) {
  const now = Date.now();
  if (gameIdMemo.id && now - gameIdMemo.at < GAME_ID_TTL_MS) return gameIdMemo.id;
  const state = await prisma.gameState.findUnique({ where: { id: 1 }, select: { gameId: true } });
  if (state?.gameId) gameIdMemo = { id: state.gameId, at: now };
  return state?.gameId ?? gameIdMemo.id;
}

// The wipe calls this so the next row lands in the new game at once.
function forgetGameId() {
  gameIdMemo = { id: null, at: 0 };
}

// The open turn, so a row can be stamped with when it happened in the fiction. Callers that already hold the turn (advanceTurn, the turn passes) pass it in to skip the lookup.
async function resolveTurn(prisma, turn) {
  if (turn) return turn;
  return prisma.turn.findFirst({ where: { status: "OPEN" } });
}

// One proxied character message. `concealedAlias` is non-null only for a /conceal send — both halves are kept since the panel renders "Young Man (Sir Alder)": the alias is what the room saw, characterName who it actually was. `presentedAvatarPath` is the face that went with it, frozen the same way, null when the room saw their own.
// `rethrow` is for the one caller that needs to SEE a failure: the proxy claims its row before posting to Discord (bot/src/lib/proxy.js), and the point of that claim is the P2002 a redelivered messageCreate raises on `sourceDiscordMessageId` — safely() would swallow it and a second post would go out. Every other caller keeps the swallow: an archive write must never be the thing that breaks a turn pass.
// What the room could see of the speaker, for the freeze this row carries. The caller usually supplies it (say.js builds it from the same query that resolves identity, so the proxy path pays nothing extra); when it doesn't, this loads it, so the invariant is one sentence: EVERY message row with a character and a place carries a snapshot. The placeKey guard matches examineRow.js: a row with no place can never carry a look, so freezing one would be waste. Never allowed to fail the send — the proxy calls with `rethrow: true` and a lost message is lost for good, while a lost snapshot just degrades that line to the live read it would have had anyway.
async function resolvePresentedState(prisma, entry) {
  if (entry.presentedState !== undefined) return entry.presentedState;
  if (!entry.character?.id || !entry.placeKey) return null;
  try {
    const { state } = await loadPresentedState(prisma, entry.character.id);
    return state;
  } catch (err) {
    console.error("Presented-state snapshot failed:", err);
    return null;
  }
}

async function recordArchiveMessage(prisma, entry, { rethrow = false } = {}) {
  const run = async () => {
    const [turn, gameId, presentedState] = await Promise.all([
      resolveTurn(prisma, entry.turn),
      currentGameId(prisma),
      resolvePresentedState(prisma, entry),
    ]);
    const row = await prisma.archiveEntry.create({
      data: {
        kind: "MESSAGE",
        gameId,
        turnNumber: turn?.number ?? null,
        turnPhase: turn?.phase ?? null,
        sentAt: entry.sentAt ?? new Date(),
        zoneId: entry.zoneId ?? null,
        zoneName: entry.zoneName ?? null,
        characterId: entry.character?.id ?? null,
        characterName: entry.character?.name ?? null,
        concealedAlias: entry.concealedAlias ?? null,
        presentedAvatarPath: entry.presentedAvatarPath ?? null,
        // The third frozen column. DbNull, not null, is how a Json column is told to hold a SQL NULL — a bare null is the other kind of nothing on a Json field, and "not frozen" is the one meant here.
        presentedState: presentedState ?? Prisma.DbNull,
        content: entry.content ?? "",
        discordMessageId: entry.discordMessageId ?? null,
        // The player's original message, when one produced this row. The unique index on it is what stops a redelivered Discord event becoming a second post — see the field's note in schema.prisma.
        sourceDiscordMessageId: entry.sourceDiscordMessageId ?? null,
        channelKind: entry.channelKind ?? null,
        threadName: entry.threadName ?? null,
        discordChannelId: entry.discordChannelId ?? null,
        placeKey: entry.placeKey ?? null,
        source: entry.source ?? "DISCORD",
        // A row the bot itself just posted is already on Discord, so the outbox has nothing to do with it; a WEB row leaves this null, exactly what the outbox looks for.
        discordSyncedAt: entry.discordMessageId ? new Date() : null,
      },
    });

    // After the insert, never inside it: a listener woken before the row is committed would look it up and find nothing. `clientId` rides along so the tab that typed this meets its own row as the one it already drew, rather than a second one (feedNotify.js).
    if (row.placeKey) {
      await notifyFeed(prisma, { seq: row.seq, placeKey: row.placeKey, clientId: entry.clientId ?? null });
    }
    return row;
  };
  return rethrow ? run() : safely("message write", run);
}

// A system event — a turn opening, a death, a fulfilled Desire. Same table as messages so the two interleave chronologically and the transcript reads as a diary, not a chat log with no context.
async function recordArchiveEvent(prisma, entry) {
  return safely(`${entry.kind} write`, async () => {
    const [turn, gameId] = await Promise.all([resolveTurn(prisma, entry.turn), currentGameId(prisma)]);
    const row = await prisma.archiveEntry.create({
      data: {
        kind: entry.kind,
        gameId,
        turnNumber: turn?.number ?? null,
        turnPhase: turn?.phase ?? null,
        sentAt: entry.sentAt ?? new Date(),
        zoneId: entry.zoneId ?? null,
        zoneName: entry.zoneName ?? null,
        characterId: entry.character?.id ?? entry.characterId ?? null,
        characterName: entry.character?.name ?? entry.characterName ?? null,
        content: entry.content ?? "",
        placeKey: entry.placeKey ?? null,
        source: entry.source ?? "SYSTEM",
      },
    });

    if (row.placeKey) await notifyFeed(prisma, { seq: row.seq, placeKey: row.placeKey });
    return row;
  });
}

// The row a Discord message id belongs to — what reactions look themselves up with, in place of the in-memory recentProxies map a restart used to empty.
async function archiveRowForMessage(prisma, discordMessageId) {
  if (!discordMessageId) return null;
  return prisma.archiveEntry.findUnique({
    where: { discordMessageId },
    select: {
      id: true,
      seq: true,
      placeKey: true,
      characterId: true,
      characterName: true,
      concealedAlias: true,
      presentedAvatarPath: true,
      content: true,
      sentAt: true,
      deletedAt: true,
      kind: true,
    },
  });
}

// Take a row back that nobody should have seen — the proxy's claim row when the
// Discord post it was written for then failed. Soft, and it notifies, for the same reason deleteSpeech is: the insert already woke every stream watching that place, so a hard delete would leave those tabs holding a line Discord never heard. Not deleteSpeech itself (the PLAYER's take-back, with an edit window and an owner check) — this is the bot tidying up after itself.
async function retractArchiveRow(prisma, id) {
  return safely("row retraction", async () => {
    const row = await prisma.archiveEntry.update({
      where: { id },
      data: { deletedAt: new Date() },
      select: { seq: true, placeKey: true },
    });
    if (row.placeKey) {
      await notifyFeed(prisma, { seq: row.seq, placeKey: row.placeKey, op: "delete" });
    }
    return row;
  });
}

module.exports = {
  FEED_ROW_SELECT,
  ARCHIVE_ROW_SELECT,
  feedRowShape,
  withAvatarVersions,
  archiveRowsShape,
  currentGameId,
  forgetGameId,
  recordArchiveMessage,
  recordArchiveEvent,
  archiveRowForMessage,
  retractArchiveRow,
};
