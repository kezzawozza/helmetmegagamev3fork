import "server-only";
import { Client } from "pg";
import { prisma, feedRowShape, FEED_ROW_SELECT } from "@lifeweb/db";
import { FEED_CHANNEL } from "@lifeweb/db/lib/feedNotify";
import { PRESENCE_CHANNEL } from "@lifeweb/db/lib/presenceNotify";
import { TYPING_CHANNEL } from "@lifeweb/db/lib/typingNotify";
import { DM_CHANNEL } from "@lifeweb/db/lib/dmNotify";
import { DESK_CHANNEL } from "@lifeweb/db/lib/deskNotify";
import { withoutDmNoise, PLAYER_DM_SELECT, playerDmRow, GM_DM_SELECT, gmDmRow } from "./dmThread";
import { dmActionOf } from "@lifeweb/db/lib/dmActions";
import { loadForcedName, loadConcealment, presentedIdentity } from "@lifeweb/db/lib/presentedIdentity";

// One Postgres LISTEN per web process, fanned out to every open SSE stream.
//
// The alternative was a poll, which is what the GM inbox does at 3 s. Chat
// cannot feel right on a poll, and a socket service would be a whole new
// Railway deployment for traffic that is one-directional anyway (sends are an
// ordinary POST). Railway runs `next start` as one long-lived Node server with
// one replica, so a module singleton reaches every stream in the process.
//
// Kept on globalThis for the same reason the Prisma client is: `next dev`
// re-evaluates a module on every hot reload, and a fresh listener per reload
// would leak a database connection each time.

const HUB_KEY = "__bascinetFeedHub";
// Bumped whenever createHub() gains a field, so a hot reload backfills an
// older hub instead of throwing on the missing one. See hub().
const HUB_SHAPE = 5;
const BACKOFF_MIN_MS = 1000;
const BACKOFF_MAX_MS = 60_000;

function createHub() {
  return {
    shape: HUB_SHAPE,
    // placeKey -> Set<(row) => void>
    subscribers: new Map(),
    // characterId -> Set<() => void>. The second channel, added in phase 2:
    // a character's PLACE LIST changes when they walk, when a key opens a
    // door, or when somebody lets them into a conversation, and an open
    // stream has to resubscribe rather than wait for the tab to reload.
    presenceSubscribers: new Map(),
    // placeKey -> Set<({ placeKey, characterId, name }) => void>. The third
    // channel, added in phase 6, and the only one whose payload the hub
    // enriches before fanning it: the notify carries an id, and the presented
    // name is resolved here (see typingNameFor).
    typingSubscribers: new Map(),
    // discordUserId -> Set<(row) => void>. The fourth channel: a DirectMessage
    // landed for this account, and Chat's Bascinet conversation is open
    // in a tab (CHAT.md §2b). Raised by a Postgres trigger rather than by any
    // writer (db/lib/dmNotify.js).
    dmSubscribers: new Map(),
    // Set<(row) => void>, and the only one keyed on NOTHING. A player's
    // conversation belongs to one account, so the map above is the right
    // shape for it; the GM desk's inbox is every conversation at once, and
    // keying that by recipient would mean subscribing to a few hundred keys
    // and resubscribing whenever somebody new wrote in. So the desk takes the
    // firehose and the stream decides what to do with it.
    //
    // The trigger already fires for every row (db/prisma/migrations/
    // 20260913060000_dm_notify), so this costs no migration and no second
    // channel — only a second fan-out of a notification already arriving.
    gmDmSubscribers: new Set(),
    // Set<({ t, id, op }) => void>. The fifth channel, and keyed on nothing
    // for the same reason gmDmSubscribers is: the adjudication desk watches
    // every row of its four types at once, and there is no smaller thing to
    // subscribe to. Raised by four Postgres triggers rather than by any
    // writer (db/lib/deskNotify.js, ADJUDICATION.md §3).
    //
    // THE HUB READS NOTHING ON THIS CHANNEL. Both DM paths above re-read the
    // row here, because the shape they fan out is the shape that goes on the
    // wire. A desk row is not: the stream coalesces a beat's worth of ids and
    // re-reads them in ONE deskPatchFor() call, so a burst — a turn-end push
    // touching two hundred staged rows — costs one query per frame instead of
    // two hundred here.
    deskSubscribers: new Set(),
    // characterId -> { name, at }. A typing event fires every few seconds per
    // person, and resolving forced name + concealment is two queries; nobody's
    // mask comes off often enough to pay that on every keystroke burst.
    nameMemo: new Map(),
    client: null,
    connecting: false,
    backoffMs: BACKOFF_MIN_MS,
    // Whether this hub has ever held a LISTEN. A connect after that is a
    // RE-connect, and everything raised in the gap is gone — see resyncDm.
    everConnected: false,
    // When the listener went away, so the reconnect can say how long the feed
    // was dark. Null while it is up. Only ever a log line — nothing branches
    // on it.
    downSince: null,
    // Which channels the LIVE client is actually listening on. Not the same
    // question as "has it connected": hub() backfills a hub built by an older
    // copy of this file on a hot reload, and a channel added to CHANNELS since
    // then has a field here but no LISTEN on the session that is already open —
    // which is how the desk channel came to be subscribed to by a hub that was
    // never told about it, silently, with the stream up and no frames on it.
    // connect() reconciles this against CHANNELS every time it is called,
    // including the early return when a client already exists.
    listened: new Set(),
  };
}

function hub() {
  const existing = globalThis[HUB_KEY];
  if (!existing) {
    globalThis[HUB_KEY] = createHub();
    return globalThis[HUB_KEY];
  }
  // `next dev` re-evaluates this module on a hot reload but keeps the object
  // on globalThis, so a hub built by an OLDER copy of this file is missing any
  // field added since — and the first call reaching for one throws. Backfill
  // rather than rebuild: rebuilding would drop the live pg client and every
  // open subscription with it.
  //
  // Behind a stamp so the ordinary path stays a property read — hub() is
  // called on every fan-out, and building a throwaway hub each time to diff
  // against would not be free. BUMP HUB_SHAPE when adding a field above.
  if (existing.shape !== HUB_SHAPE) {
    for (const [key, value] of Object.entries(createHub())) {
      if (existing[key] === undefined) existing[key] = value;
    }
    existing.shape = HUB_SHAPE;
  }
  return existing;
}

// A subscriber's callback is player code as far as this module is concerned —
// a closed stream throws on write. One bad subscriber must never stop the
// others from being told, and must never take the process down.
function fanOut(placeKey, row) {
  const set = hub().subscribers.get(placeKey);
  if (!set) return;
  for (const send of [...set]) {
    try {
      send(row);
    } catch (err) {
      console.error("Feed subscriber failed:", err);
    }
  }
}

// Presence carries nothing but a character id on purpose. The stream re-asks
// db/lib/feedAccess.js#placesFor for itself, so a notification is a nudge and
// never an authorisation.
function handlePresence(payload) {
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return;
  }
  const set = hub().presenceSubscribers.get(parsed?.characterId);
  if (!set) return;
  for (const wake of [...set]) {
    try {
      wake();
    } catch (err) {
      console.error("Presence subscriber failed:", err);
    }
  }
}

const NAME_MEMO_MS = 30_000;

// The name this character is WEARING, not the name on their sheet. A typing
// line is a line in the scene, so it obeys the same forced-name > concealment
// > own-name order every message does (db/lib/presentedIdentity.js) — a mask
// that hides who spoke and then announces who is about to would be worse than
// no line at all.
async function typingNameFor(characterId) {
  const h = hub();
  const cached = h.nameMemo.get(characterId);
  // A miss on `name` rather than on the key: the same entry is written by
  // avatarVersionFor below, which knows the face and not the mask.
  if (cached && cached.name != null && Date.now() - cached.at < NAME_MEMO_MS) return cached.name;

  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: { id: true, name: true, concealed: true, age: true, gender: true, updatedAt: true },
  });
  if (!character) return null;
  const [forcedName, concealment] = await Promise.all([
    loadForcedName(prisma, characterId),
    loadConcealment(prisma, characterId),
  ]);
  const name = presentedIdentity(character, { forcedName, concealment }).name ?? null;
  h.nameMemo.set(characterId, {
    ...(cached ?? {}),
    name,
    avatarVersion: character.updatedAt?.getTime?.() ?? null,
    at: Date.now(),
  });
  return name;
}

// The cache-buster on a face's URL, which has to be the character's updatedAt
// and nothing else.
//
// ArchiveEntry holds characterId as a SNAPSHOT column, not a foreign key
// (schema.prisma), so a row cannot join its character and feedRowShape falls
// back to the row's own sentAt. That fallback is a different number for every
// message, so /api/avatar/<id>?v=… changed on every line and the browser
// refetched a face it already had — most visibly on your own send, where the
// optimistic row (updatedAt) and the streamed row (sentAt) disagreed and the
// avatar blinked. Memoised beside the typing name for the same reason: nobody
// gets a new portrait often enough to pay a query per message.
async function avatarVersionFor(characterId) {
  if (!characterId) return null;
  const h = hub();
  const cached = h.nameMemo.get(characterId);
  if (cached && Date.now() - cached.at < NAME_MEMO_MS && cached.avatarVersion !== undefined) {
    return cached.avatarVersion;
  }
  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: { updatedAt: true },
  });
  const avatarVersion = character?.updatedAt?.getTime?.() ?? null;
  h.nameMemo.set(characterId, { ...(cached ?? { name: null }), at: Date.now(), avatarVersion });
  return avatarVersion;
}

async function handleTyping(payload) {
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return;
  }
  if (!parsed?.placeKey || !parsed?.characterId) return;

  // Nobody in this process is watching that place, so nothing is worth
  // spending on a name.
  const set = hub().typingSubscribers.get(parsed.placeKey);
  if (!set || set.size === 0) return;

  const name = await typingNameFor(parsed.characterId);
  if (!name) return;

  const event = { placeKey: parsed.placeKey, characterId: parsed.characterId, name };
  for (const send of [...set]) {
    try {
      send(event);
    } catch (err) {
      console.error("Typing subscriber failed:", err);
    }
  }
}

// A DirectMessage row landed. The payload is an id and the account it is for,
// and the row is re-read here through the desk's own noise filter
// (dmThread.js#withoutDmNoise, player chair) — an inspect embed is not
// conversation on either face, and a mention relay IS one here: it reaches
// the player's pane exactly as the Discord DM reaches their inbox.
// What goes out is the PLAYER's shape of the row: no author.
async function handleDm(parsed) {
  if (!parsed?.discordUserId) return;
  const set = hub().dmSubscribers.get(String(parsed.discordUserId));
  if (!set || set.size === 0) return;

  const row = await prisma.directMessage.findFirst({
    where: withoutDmNoise(
      { id: String(parsed.id), discordUserId: String(parsed.discordUserId) },
      { perspective: "player" },
    ),
    select: PLAYER_DM_SELECT,
  });
  if (!row) return;
  // A row arriving down the stream was written a moment ago, so anything it
  // asks is by definition still open — no need to go and ask the database
  // (web/lib/dmActions.js). A page load re-resolves it properly.
  const shaped = { ...playerDmRow(row), actionable: Boolean(dmActionOf(row)) };
  for (const send of [...set]) {
    try {
      send(shaped);
    } catch (err) {
      console.error("DM subscriber failed:", err);
    }
  }
}

// The same notification, read again for the GM desk.
//
// A SECOND read rather than a reshape of the first, because the two chairs do
// not see the same rows or the same columns. The player's filter keeps mention
// relays and drops the author; the desk's drops the relays and needs the
// author to say who answered (dmThread.js). Sharing one read would mean one
// chair quietly getting the other's rules, which is the class of bug
// withoutDmNoise's `perspective` exists to prevent.
//
// It costs one indexed lookup, and only when a GM actually has the desk open —
// there are five of them, against a hundred players.
async function handleGmDm(parsed) {
  const set = hub().gmDmSubscribers;
  if (set.size === 0) return;

  const row = await prisma.directMessage.findFirst({
    where: withoutDmNoise({ id: String(parsed.id) }, { perspective: "gm" }),
    select: GM_DM_SELECT,
  });
  // Filtered out for the desk — an inspect embed, or a mention relay. The
  // player's pane may still have had it; that is the point of two filters.
  if (!row) return;

  const shaped = gmDmRow(row);
  for (const send of [...set]) {
    try {
      send(shaped);
    } catch (err) {
      console.error("GM DM subscriber failed:", err);
    }
  }
}

// The pg client dropped and came back, so every row written in the gap was
// never fanned out to anybody. Both sides need telling, and for the same
// reason: the browser's own EventSource never broke, so nothing else would.
//
// Places recover by asking their stream to catch up from its own cursor. That
// works precisely because the cursor is frozen during an outage — no rows
// arrive, so nothing advances it, and every row written in the gap is still
// ABOVE it. This used to be left to "the place feed papers over the gap with
// its `since` cursor", which was only true if something happened to trigger a
// catch-up; if the reader sat still, the gap stayed a hole in the scene.
function resyncPlaces() {
  for (const set of hub().subscribers.values()) {
    for (const send of [...set]) {
      try {
        send({ resync: true });
      } catch (err) {
        console.error("Place subscriber failed:", err);
      }
    }
  }
}

// The DM path has no cursor at all, so its pane asks for the whole page again
// (CHAT.md §2b).
function resyncDm() {
  for (const set of hub().dmSubscribers.values()) {
    for (const send of [...set]) {
      try {
        send({ resync: true });
      } catch (err) {
        console.error("DM subscriber failed:", err);
      }
    }
  }
  // The desk has no cursor on this channel either, but unlike the player's
  // pane it has somewhere to go: its stream re-asks inboxDelta.js from its own
  // clock cursor, which cannot have moved during the outage. Same sentinel,
  // and it matters more here — the desk going quiet without saying so is the
  // exact failure GMs have been reporting.
  for (const send of [...hub().gmDmSubscribers]) {
    try {
      send({ resync: true });
    } catch (err) {
      console.error("GM DM subscriber failed:", err);
    }
  }
}

// A desk row changed. Nothing is read: the bare {t, id, op} goes straight to
// every open adjudication stream, which decides what to do with it.
function handleDesk(payload) {
  const set = hub().deskSubscribers;
  // No desk open in this process, so the notification costs a parse we don't
  // even pay.
  if (set.size === 0) return;
  let parsed;
  try {
    parsed = JSON.parse(payload);
  } catch {
    return;
  }
  if (!parsed?.t || !parsed?.id) return;
  const event = { t: String(parsed.t), id: String(parsed.id), op: parsed.op === "gone" ? "gone" : "row" };
  for (const send of [...set]) {
    try {
      send(event);
    } catch (err) {
      console.error("Desk subscriber failed:", err);
    }
  }
}

// The desk's half of the reconnect sentinel. Its stream has no cursor to
// re-ask from — a patch is a list of ids, not a window in time — so the
// answer is coarser than the inbox's: it tells the tab to fetch the page
// again, once, through its own stale gate.
function resyncDesk() {
  for (const send of [...hub().deskSubscribers]) {
    try {
      send({ resync: true });
    } catch (err) {
      console.error("Desk subscriber failed:", err);
    }
  }
}

async function handleNotification(msg) {
  if (msg.channel === DM_CHANNEL) {
    if (!msg.payload) return;
    let parsed;
    try {
      parsed = JSON.parse(msg.payload);
    } catch {
      return;
    }
    if (!parsed?.id) return;
    // Both chairs, from one notification. Neither waits on the other: a slow
    // read for a desk nobody has open must not hold up a player's pane.
    await Promise.allSettled([handleDm(parsed), handleGmDm(parsed)]);
    return;
  }
  if (msg.channel === DESK_CHANNEL) {
    if (msg.payload) handleDesk(msg.payload);
    return;
  }
  if (msg.channel === PRESENCE_CHANNEL) {
    if (msg.payload) handlePresence(msg.payload);
    return;
  }
  if (msg.channel === TYPING_CHANNEL) {
    if (msg.payload) await handleTyping(msg.payload);
    return;
  }
  if (msg.channel !== FEED_CHANNEL || !msg.payload) return;
  let parsed;
  try {
    parsed = JSON.parse(msg.payload);
  } catch {
    return;
  }
  if (!parsed?.seq || !parsed?.placeKey) return;
  const op = parsed.op ?? "new";

  // Nobody in this process is watching that place, so there is no reason to
  // pay for the row.
  const set = hub().subscribers.get(parsed.placeKey);
  if (!set || set.size === 0) return;

  // seq crosses the wire as a string; BigInt, never Number — the column is a
  // bigint and a Number cursor loses precision at the top of the range.
  const row = await prisma.archiveEntry.findUnique({
    where: { seq: BigInt(parsed.seq) },
    select: FEED_ROW_SELECT,
  });
  if (!row) return;

  // A deleted row is still an event — a browser holding it has to be told to
  // drop it. Only its seq goes out; the words that were taken back do not.
  if (row.deletedAt || op === "delete") {
    fanOut(parsed.placeKey, { op: "delete", seq: String(row.seq), placeKey: parsed.placeKey });
    return;
  }

  // An edit goes out as the whole row, and the client replaces by seq. That
  // way there is one shape on the wire for "here is a message" whether it is
  // the first time or the second.
  //
  // `clientId` goes back out to EVERY watcher of the place, not just the tab
  // that sent it. That is fine and cheaper than the alternative: it is a
  // random token with nothing in it, and a browser only ever acts on one it
  // is still holding a pending row for.
  fanOut(
    parsed.placeKey,
    feedRowShape(row, {
      op: op === "edit" ? "edit" : "new",
      avatarVersion: await avatarVersionFor(row.characterId),
      ...(parsed.clientId ? { clientId: String(parsed.clientId) } : {}),
    }),
  );
}

function scheduleReconnect() {
  const h = hub();
  const wait = h.backoffMs;
  h.backoffMs = Math.min(h.backoffMs * 2, BACKOFF_MAX_MS);
  const timer = setTimeout(() => {
    connect().catch((err) => console.error("Feed hub reconnect failed:", err));
  }, wait);
  timer.unref?.();
}

const CHANNELS = [FEED_CHANNEL, PRESENCE_CHANNEL, TYPING_CHANNEL, DM_CHANNEL, DESK_CHANNEL];

// Issue a LISTEN for every channel this session is not already on. Idempotent
// and cheap — the ordinary call is five Set lookups and no query.
async function listenAll(client, h) {
  for (const channel of CHANNELS) {
    if (h.listened.has(channel)) continue;
    // Channel names are module constants, never anything a caller supplies.
    await client.query(`LISTEN ${channel}`);
    h.listened.add(channel);
  }
}

// A single Client, not a Pool: LISTEN belongs to one session, and a pooled
// connection can be handed to another query between notifications.
async function connect() {
  const h = hub();
  if (h.client) {
    // Already connected — but not necessarily to everything. See `listened`.
    await listenAll(h.client, h).catch((err) => console.error("Feed hub LISTEN failed:", err));
    return;
  }
  if (h.connecting) return;
  if (!process.env.DATABASE_URL) {
    console.warn("Feed hub: no DATABASE_URL, the live feed will not update.");
    return;
  }
  h.connecting = true;

  const client = new Client({ connectionString: process.env.DATABASE_URL });

  const drop = (err) => {
    if (h.client !== client && h.connecting === false) return;
    // Said out loud even when the session ended CLEANLY, which is the case
    // that used to pass in silence. While the hub is down nothing is fanned
    // out to anybody, so every open tab goes quiet until the reconnect below
    // resyncs it — and that looks, from a player's chair, exactly like the
    // website lagging minutes behind Discord. Players have reported that;
    // without a line here there was no way to check a report against the
    // logs. The recovery line names how long the gap was.
    if (err) console.error("Feed hub listener error:", err);
    else console.warn("Feed hub listener ended; the live feed is down until it reconnects.");
    h.downSince = Date.now();
    if (h.client === client) h.client = null;
    h.connecting = false;
    // The session is gone and so are its LISTENs; the next connect re-issues
    // them all.
    h.listened = new Set();
    client.removeAllListeners();
    client.end().catch(() => {});
    scheduleReconnect();
  };

  client.on("error", drop);
  client.on("end", () => drop(null));
  // FEED notifications run ONE AT A TIME; everything else stays concurrent.
  //
  // This was fire-and-forget for every channel, and that was enough on its own
  // to lose a message. handleFeed awaits a row lookup and an avatar lookup
  // before it fans anything out, so two notifications that arrive in the right
  // order can still reach fanOut in the wrong one — and the stream's cursor in
  // web/app/api/feed/route.js used to drop anything below its high-water mark,
  // permanently. Ordering the fan-out costs one indexed lookup of latency per
  // message and removes the race at its source.
  //
  // Typing, presence and DM stay off the chain deliberately: a typing frame
  // held up behind a slow row lookup is a worse trade, and none of them is
  // ordered against anything.
  let feedQueue = Promise.resolve();
  client.on("notification", (msg) => {
    const run = () => handleNotification(msg).catch((err) => console.error("Feed hub notification failed:", err));
    if (msg.channel !== FEED_CHANNEL) {
      void run();
      return;
    }
    feedQueue = feedQueue.then(run);
  });

  try {
    await client.connect();
    // Every channel on the ONE client: LISTEN belongs to a session, and a
    // second connection would double the reconnect logic for no gain.
    h.listened = new Set();
    await listenAll(client, h);
    h.client = client;
    h.connecting = false;
    h.backoffMs = BACKOFF_MIN_MS;
    if (h.everConnected) {
      const gap = h.downSince ? Math.round((Date.now() - h.downSince) / 1000) : null;
      console.warn(`Feed hub reconnected${gap === null ? "" : ` after ${gap}s`}; resyncing every open stream.`);
      resyncPlaces();
      resyncDm();
      resyncDesk();
    }
    h.downSince = null;
    h.everConnected = true;
  } catch (err) {
    console.error("Feed hub could not start listening:", err);
    drop(null);
  }
}

// Returns an unsubscribe. The caller (the SSE route) calls it from the
// request's abort handler, so a closed tab takes its subscription with it.
export function subscribeToPlace(placeKey, send) {
  const h = hub();
  let set = h.subscribers.get(placeKey);
  if (!set) {
    set = new Set();
    h.subscribers.set(placeKey, set);
  }
  set.add(send);

  connect().catch((err) => console.error("Feed hub connect failed:", err));

  return () => {
    const current = h.subscribers.get(placeKey);
    if (!current) return;
    current.delete(send);
    if (current.size === 0) h.subscribers.delete(placeKey);
  };
}

// The same contract again, for the typing channel. Separate from
// subscribeToPlace because a stream subscribes to both for the same place and
// has to be able to drop one without the other — and because a typing event
// is not a row, so mixing it into the row fan-out would put a shape on that
// wire that every reader would have to test for.
export function subscribeToTyping(placeKey, send) {
  const h = hub();
  let set = h.typingSubscribers.get(placeKey);
  if (!set) {
    set = new Set();
    h.typingSubscribers.set(placeKey, set);
  }
  set.add(send);

  connect().catch((err) => console.error("Feed hub connect failed:", err));

  return () => {
    const current = h.typingSubscribers.get(placeKey);
    if (!current) return;
    current.delete(send);
    if (current.size === 0) h.typingSubscribers.delete(placeKey);
  };
}

// The same contract as subscribeToPlace, for the other channel: returns an
// unsubscribe the SSE route calls from the request's abort handler.
export function subscribeToPresence(characterId, wake) {
  const h = hub();
  if (!characterId) return () => {};
  let set = h.presenceSubscribers.get(characterId);
  if (!set) {
    set = new Set();
    h.presenceSubscribers.set(characterId, set);
  }
  set.add(wake);

  connect().catch((err) => console.error("Feed hub connect failed:", err));

  return () => {
    const current = h.presenceSubscribers.get(characterId);
    if (!current) return;
    current.delete(wake);
    if (current.size === 0) h.presenceSubscribers.delete(characterId);
  };
}

// The same contract once more, keyed on the Discord account rather than on a
// place: a DM is addressed to a person, wherever their character stands.
export function subscribeToDm(discordUserId, send) {
  const h = hub();
  if (!discordUserId) return () => {};
  const key = String(discordUserId);
  let set = h.dmSubscribers.get(key);
  if (!set) {
    set = new Set();
    h.dmSubscribers.set(key, set);
  }
  set.add(send);

  connect().catch((err) => console.error("Feed hub connect failed:", err));

  return () => {
    const current = h.dmSubscribers.get(key);
    if (!current) return;
    current.delete(send);
    if (current.size === 0) h.dmSubscribers.delete(key);
  };
}

// Every DirectMessage, for a reader whose job is all of them: the GM desk's
// inbox (PLAYER-DESK.md §9a). The same unsubscribe contract as the other four
// and no key, because there is nothing to key on — see gmDmSubscribers.
//
// This is NOT a gate. Like the presence channel, a notification here is a
// nudge and never an authorisation: the caller is the desk's SSE route, which
// has already established that this reader is a GM and re-reads what it is
// allowed to send. Subscribing does not make anybody a GM.
export function subscribeToAllDms(send) {
  const h = hub();
  h.gmDmSubscribers.add(send);

  connect().catch((err) => console.error("Feed hub connect failed:", err));

  return () => {
    h.gmDmSubscribers.delete(send);
  };
}

// Every desk row change, for a reader whose job is all of them: the
// adjudication desk (ADJUDICATION.md §3). The same unsubscribe contract as
// subscribeToAllDms and no key, because there is nothing to key on — see
// deskSubscribers.
//
// This is NOT a gate. The caller is the desk's SSE route, which has already
// established that the reader is a GM and re-reads every row it sends through
// web/lib/deskRows.js. Subscribing does not make anybody a GM.
export function subscribeToDesk(send) {
  const h = hub();
  h.deskSubscribers.add(send);

  connect().catch((err) => console.error("Feed hub connect failed:", err));

  return () => {
    h.deskSubscribers.delete(send);
  };
}
