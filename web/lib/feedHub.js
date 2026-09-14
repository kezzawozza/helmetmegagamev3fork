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

// One Postgres LISTEN per web process, fanned out to every open SSE stream —
// Railway runs `next start` as one long-lived Node server with one replica,
// so a module singleton reaches every stream in it. Kept on globalThis so a
// `next dev` hot reload does not leak a fresh listener/database connection.

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
    // characterId -> Set<() => void>. A character's PLACE LIST changes on a
    // walk, a key, or a conversation invite, so an open stream resubscribes.
    presenceSubscribers: new Map(),
    // placeKey -> Set<({ placeKey, characterId, name }) => void>. The only
    // channel whose payload the hub enriches before fanning it (see typingNameFor).
    typingSubscribers: new Map(),
    // discordUserId -> Set<(row) => void>. A DirectMessage landed for this
    // account (CHAT.md §2b). Raised by a Postgres trigger (db/lib/dmNotify.js).
    dmSubscribers: new Map(),
    // Set<(row) => void>, keyed on NOTHING: the GM desk's inbox is every
    // conversation at once, so it takes the firehose and decides for itself.
    gmDmSubscribers: new Set(),
    // Set<({ t, id, op }) => void>. Keyed on nothing for the same reason:
    // the adjudication desk watches every row of its four types at once.
    // Raised by four Postgres triggers (db/lib/deskNotify.js, ADJUDICATION.md §3).
    // THE HUB READS NOTHING ON THIS CHANNEL — a burst re-reads via ONE
    // deskPatchFor() call per frame instead of per row.
    deskSubscribers: new Set(),
    // characterId -> { name, at }. Resolving forced name + concealment is
    // two queries; nobody's mask comes off often enough to pay that per keystroke.
    nameMemo: new Map(),
    client: null,
    connecting: false,
    backoffMs: BACKOFF_MIN_MS,
    // Whether this hub has ever held a LISTEN — a connect after that is a
    // RE-connect, and everything raised in the gap is gone. See resyncDm.
    everConnected: false,
    // When the listener went away; null while up. Log-line only.
    downSince: null,
    // Which channels the LIVE client is listening on — connect() reconciles
    // this against CHANNELS every call, since a hot-reload-backfilled hub can
    // gain a channel with a field here but no LISTEN on the already-open session.
    listened: new Set(),
  };
}

function hub() {
  const existing = globalThis[HUB_KEY];
  if (!existing) {
    globalThis[HUB_KEY] = createHub();
    return globalThis[HUB_KEY];
  }
  // Backfill rather than rebuild an older-shaped hub — rebuilding would drop
  // the live pg client and every open subscription. BUMP HUB_SHAPE above
  // when adding a field; the stamp keeps the ordinary path a property read.
  if (existing.shape !== HUB_SHAPE) {
    for (const [key, value] of Object.entries(createHub())) {
      if (existing[key] === undefined) existing[key] = value;
    }
    existing.shape = HUB_SHAPE;
  }
  return existing;
}

// A closed stream throws on write; one bad subscriber must never stop the
// others or take the process down.
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

// Presence carries only a character id — the stream re-asks
// db/lib/feedAccess.js#placesFor itself, so a notification is a nudge, never an authorisation.
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

// The name this character is WEARING, obeying forced-name > concealment >
// own-name (db/lib/presentedIdentity.js) — a typing line must not out a masked speaker.
async function typingNameFor(characterId) {
  const h = hub();
  const cached = h.nameMemo.get(characterId);
  // A miss on `name`, not the key: avatarVersionFor below writes the same entry.
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

// The cache-buster on a face's URL, which must be the character's updatedAt
// only — ArchiveEntry holds characterId as a snapshot column, not a foreign
// key (schema.prisma), so feedRowShape's own-row sentAt fallback changed on
// every message and made your own avatar blink on send. Memoised beside the
// typing name for the same reason: nobody gets a new portrait per message.
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

// A DirectMessage row landed. Re-read through the player chair's noise
// filter (dmThread.js#withoutDmNoise) — a mention relay IS conversation
// here, an inspect embed isn't. What goes out is the PLAYER's row shape: no author.
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
  // Freshly written, so whatever it asks (web/lib/dmActions.js) is still
  // open — no need to re-check the database. A page load re-resolves it properly.
  const shaped = { ...playerDmRow(row), actionable: Boolean(dmActionOf(row)) };
  for (const send of [...set]) {
    try {
      send(shaped);
    } catch (err) {
      console.error("DM subscriber failed:", err);
    }
  }
}

// The same notification, re-read for the GM desk with the GM chair's own
// filter (dmThread.js) — a second read, not a reshape, since the two chairs
// keep different rows and columns and must never share one chair's rules.
async function handleGmDm(parsed) {
  const set = hub().gmDmSubscribers;
  if (set.size === 0) return;

  const row = await prisma.directMessage.findFirst({
    where: withoutDmNoise({ id: String(parsed.id) }, { perspective: "gm" }),
    select: GM_DM_SELECT,
  });
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

// The pg client dropped and came back; every row written in the gap was
// never fanned out, and the browser's own EventSource never broke — so
// nothing else notices. Places recover from their own frozen cursor, which
// stopped advancing during the outage, so every gap row is still above it.
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

// The DM path has no cursor at all, so its pane asks for the whole page
// again (CHAT.md §2b).
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
  // The desk has no cursor here either, but re-asks inboxDelta.js from its
  // own clock cursor, which cannot have moved during the outage.
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

// The desk's reconnect sentinel: a patch is a list of ids, not a time
// window, so this just tells the tab to fetch the page again, once.
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
    // Both chairs, from one notification, neither blocking the other.
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

  const set = hub().subscribers.get(parsed.placeKey);
  if (!set || set.size === 0) return;

  // seq crosses the wire as a string; BigInt, never Number — the column is a
  // bigint and a Number cursor loses precision at the top of the range.
  const row = await prisma.archiveEntry.findUnique({
    where: { seq: BigInt(parsed.seq) },
    select: FEED_ROW_SELECT,
  });
  if (!row) return;

  // A deleted row is still an event — a browser holding it must be told to
  // drop it. Only its seq goes out.
  if (row.deletedAt || op === "delete") {
    fanOut(parsed.placeKey, { op: "delete", seq: String(row.seq), placeKey: parsed.placeKey });
    return;
  }

  // An edit goes out as the whole row; the client replaces by seq.
  // `clientId` goes to EVERY watcher, which is fine — it is a token a
  // browser only acts on if it is still holding a pending row for it.
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

// Issue a LISTEN for every channel this session is not already on.
// Idempotent and cheap — the ordinary call is five Set lookups, no query.
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
    // Said out loud even on a clean end: while the hub is down nothing fans
    // out and every open tab goes quiet until reconnect resyncs it — which
    // reads, from a player's chair, exactly like the site lagging behind
    // Discord. The recovery line names how long the gap was.
    if (err) console.error("Feed hub listener error:", err);
    else console.warn("Feed hub listener ended; the live feed is down until it reconnects.");
    h.downSince = Date.now();
    if (h.client === client) h.client = null;
    h.connecting = false;
    h.listened = new Set();
    client.removeAllListeners();
    client.end().catch(() => {});
    scheduleReconnect();
  };

  client.on("error", drop);
  client.on("end", () => drop(null));
  // FEED notifications run ONE AT A TIME; everything else stays concurrent.
  // handleFeed awaits a row + avatar lookup before fanning out, so two
  // notifications can otherwise arrive in order and fan out out of order —
  // and the stream's cursor (web/app/api/feed/route.js) drops anything
  // below its high-water mark permanently. Typing/presence/DM stay off this
  // chain: none of them is ordered against anything, and holding a typing
  // frame behind a slow row lookup is a worse trade.
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

// Returns an unsubscribe. The SSE route calls it from the request's abort
// handler, so a closed tab takes its subscription with it.
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

// Separate from subscribeToPlace because a stream subscribes to both for the
// same place and must drop one without the other, and a typing event is not
// a row.
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

// Keyed on the Discord account, not a place: a DM is addressed to a person,
// wherever their character stands.
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

// Every DirectMessage, for the GM desk's inbox (PLAYER-DESK.md §9a) — no key,
// because there is nothing to key on. NOT a gate: like presence, a
// notification here is a nudge, never an authorisation — the caller is the
// desk's SSE route, which has already confirmed this reader is a GM.
export function subscribeToAllDms(send) {
  const h = hub();
  h.gmDmSubscribers.add(send);

  connect().catch((err) => console.error("Feed hub connect failed:", err));

  return () => {
    h.gmDmSubscribers.delete(send);
  };
}

// Every desk row change, for the adjudication desk (ADJUDICATION.md §3) — no
// key, same reasoning as subscribeToAllDms. NOT a gate: the caller's SSE
// route has already confirmed GM status and re-reads every row through web/lib/deskRows.js.
export function subscribeToDesk(send) {
  const h = hub();
  h.deskSubscribers.add(send);

  connect().catch((err) => console.error("Feed hub connect failed:", err));

  return () => {
    h.deskSubscribers.delete(send);
  };
}
