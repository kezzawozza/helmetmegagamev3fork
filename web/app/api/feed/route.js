import { prisma, FEED_ROW_SELECT } from "@lifeweb/db";
import { withAvatarVersions } from "@lifeweb/db/lib/archive";
import { feedWipeFloors, floorForPlace, lowestFloor, placeSeqWhere } from "@lifeweb/db/lib/feedWipe";
import { makeSeenSeqs } from "@lifeweb/db/lib/seenSeqs";
import { isPlayerGhost } from "@lifeweb/db/lib/ghost";
import { loadFeedViewer, loadFeedCharacter, placesFor } from "@/lib/feedAccess";
import { subscribeToPlace, subscribeToPresence, subscribeToTyping, subscribeToDm } from "@/lib/feedHub";

// GET /api/feed?since=<seq> — ONE server-sent event stream per open tab,
// carrying every place the viewer may read.
//
// Phase 0 opened a stream per place, which was fine when there was one place.
// A Chat has a Location, its Rooms, the conversations you are in and the zone
// summary, and six EventSources per tab would each hold their own HTTP
// connection against a browser limit of six per origin — a player with two
// tabs open would have starved the rest of the site.
//
// Never cached, never prerendered: this is a connection that stays open for as
// long as the tab does.
export const dynamic = "force-dynamic";

const CATCH_UP_LIMIT = 400;
const PING_MS = 25_000;

export async function GET(request) {
  const viewer = await loadFeedViewer();
  if (!viewer.discordUserId) return new Response("Not signed in.", { status: 401 });
  if (!viewer.character && !viewer.gm && !viewer.ghost) return new Response("No living character.", { status: 403 });

  const { searchParams } = new URL(request.url);
  // ONE place, for a reader who only wants one. The GM desk's Scene tab is
  // what asks: a GM's place list is every place in every zone they may see,
  // which is hundreds of subscriptions to watch a single room. The gate is
  // unchanged — the place still has to be in placesFor() — this only narrows
  // what the stream bothers with.
  const onlyPlace = searchParams.get("place");
  const sinceParam = searchParams.get("since");
  let since = 0n;
  try {
    if (sinceParam) since = BigInt(sinceParam);
  } catch {
    return new Response("Bad cursor.", { status: 400 });
  }

  const encoder = new TextEncoder();

  // Next logs "The destination stream closed early" when a tab goes away
  // mid-stream and the source has no cancel handler; wiring one through to
  // finish() keeps the log quiet and drops the subscriptions a beat sooner.
  let finishStream = () => {};
  const stream = new ReadableStream({
    cancel() {
      finishStream();
    },
    async start(controller) {
      let closed = false;
      // Where the NEXT catch-up starts — and nothing more than that.
      //
      // It used to double as "everything at or below this has been sent", and
      // that second job is what lost messages. seq is a Postgres sequence, so
      // it is allocated in order but neither committed nor delivered in order;
      // a row that reached the hub a moment late sat below the mark and was
      // dropped at the gate, excluded from every later catch-up (`gt`), and
      // skipped by a fresh page load too, which seeds from the global max seq.
      // Gone from the website for good while Discord still had it.
      //
      // What has actually been sent is now `sent` below, which is the honest
      // version of the question.
      let lastSeq = since;
      // What this stream has actually written out — db/lib/seenSeqs.js has the
      // whole argument for why this replaced a high-water mark.
      const sent = makeSeenSeqs();
      // One hub resync in flight at a time — see sendRow.
      let resyncing = false;
      // placeKey -> { rows, typing }, each an unsubscribe. Two channels, one
      // entry: a place is subscribed and dropped as a unit.
      const subscriptions = new Map();
      // Everything the wipe put below the line, for the length of this
      // connection (db/lib/feedWipe.js). Read once: a wipe mid-stream leaves
      // rows a reader already has on their screen until the tab reloads,
      // which is the same thing that happens to a Discord client that had the
      // channel open.
      const floors = await feedWipeFloors(prisma);
      // Where the catch-up starts scanning, and nothing more. One number has
      // to serve every place on the stream, so it is the LOWER of the two
      // floors — the summary is wiped on the slower Dawn schedule and its rows
      // are legitimately older than the turn floor.
      //
      // It used to double as a suppression rule, because lastSeq was the gate
      // as well as the cursor. Whether a row is below the line is now asked per
      // place, per row, in sendRow, which is both stricter and the reason a
      // late-arriving row is no longer mistaken for an old one.
      const clamp = lowestFloor(floors);
      if (clamp > lastSeq) lastSeq = clamp;

      const write = (text) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          closed = true;
        }
      };

      // Three events on the wire, and only a NEW row moves the high-water
      // mark. An edit or a delete names a seq the stream has already sent, so
      // dropping it for being "old" would be exactly wrong.
      const sendRow = (row) => {
        // The hub's pg client dropped and came back, so rows written in the
        // gap were fanned out to nobody. The cursor cannot have moved during an
        // outage — no rows arrived — so everything missed is above it and one
        // catch-up fills the hole. Guarded so a flapping connection cannot
        // stack them.
        if (row?.resync) {
          if (!resyncing) {
            resyncing = true;
            void catchUp([...subscriptions.keys()], lastSeq).finally(() => {
              resyncing = false;
            });
          }
          return;
        }
        if (!row?.seq) return;
        const seq = BigInt(row.seq);
        if (row.op === "delete") {
          write(`event: delete\ndata: ${JSON.stringify({ seq: row.seq, placeKey: row.placeKey })}\n\n`);
          return;
        }
        if (row.op === "edit") {
          write(`event: message\ndata: ${JSON.stringify(row)}\n\n`);
          return;
        }
        // The wipe floor, per place. This is what the `clamp` above used to do
        // by folding lowestFloor into lastSeq, and it could only ever be the
        // LOWER of the two floors because one number had to serve every place
        // on the stream. Asking per row is both simpler and stricter: a zone
        // summary keeps its slower Dawn floor, a room keeps the turn floor,
        // and neither borrows the other's.
        if (seq <= floorForPlace(floors, row.placeKey)) return;
        const key = String(row.seq);
        if (sent.has(key)) return;
        sent.add(key);
        // Still the catch-up cursor, so it only ever moves forward.
        if (seq > lastSeq) lastSeq = seq;
        write(`event: message\ndata: ${JSON.stringify(row)}\n\n`);
      };

      // A fourth event name, and the only one that is not about a row. It
      // carries the PRESENTED name (the hub resolves it), never a Discord
      // account, and never this viewer's own character — nobody needs telling
      // that they are typing.
      const sendTyping = (event) => {
        if (!event?.placeKey || !event.name) return;
        if (viewer.character && event.characterId === viewer.character.id) return;
        write(`event: typing\ndata: ${JSON.stringify(event)}\n\n`);
      };

      // One page of the backlog above `from`. Returns how many rows it sent, so
      // the caller can tell a full page from the end of the road.
      const catchUpPage = async (placeKeys, from) => {
        const rows = await prisma.archiveEntry.findMany({
          where: {
            ...placeSeqWhere(floors, placeKeys, { gt: from }),
            deletedAt: null,
          },
          orderBy: { seq: "asc" },
          take: CATCH_UP_LIMIT,
          select: FEED_ROW_SELECT,
        });
        // One `?v=` per character across the batch — see
        // db/lib/archive.js#withAvatarVersions.
        for (const row of await withAvatarVersions(prisma, rows)) sendRow(row);
        return rows.length;
      };

      // The catch-up is BOUNDED, and the bound has to be honest. Two full
      // pages is the most a reconnect replays; if the second page is full as
      // well, the gap was too long to fill row by row — a phone asleep through
      // a busy evening — so the cursor is moved past it and the client is told
      // `gap`, and it asks the history route for each place instead. Silently
      // stopping at the limit is what this used to do, and it left a hole in
      // the scene that nothing ever repaired.
      const catchUp = async (placeKeys, from) => {
        if (placeKeys.length === 0) return;
        try {
          let sent = await catchUpPage(placeKeys, from);
          if (sent < CATCH_UP_LIMIT) return;
          sent = await catchUpPage(placeKeys, lastSeq);
          if (sent < CATCH_UP_LIMIT) return;
          const newest = await prisma.archiveEntry.aggregate({
            where: { ...placeSeqWhere(floors, placeKeys, { gt: lastSeq }), deletedAt: null },
            _max: { seq: true },
          });
          if (newest._max.seq !== null && newest._max.seq > lastSeq) lastSeq = newest._max.seq;
          write(`event: gap\ndata: {}\n\n`);
        } catch (err) {
          console.error("Feed catch-up failed:", err);
        }
      };

      // Recomputes the place list, tells the client, and moves the
      // subscriptions to match. A newly visible place is caught up from the
      // stream's own high-water mark rather than from zero, so walking into a
      // room does not replay a day of it — the page asks for history when the
      // reader actually opens that place.
      //
      // `reason` rides on the frame: "open" for the announce a connection
      // starts with, "presence" for one the character's own movement raised.
      // The client refreshes its right column on the second and not the
      // first — a reconnect that re-announces the same list is not news.
      //
      // The CHARACTER is read again every time, not taken from the viewer the
      // connection opened with. That object carries the Location they stood
      // in at open, and a stream now lives across their walks; computing the
      // list from it would list the street they left.
      const refreshPlaces = async ({ announce = true, catchUpNew = false, reason = "open" } = {}) => {
        let places = [];
        try {
          const character = viewer.character
            ? ((await loadFeedCharacter(viewer.discordUserId)) ?? viewer.character)
            : null;
          places = await placesFor(prisma, character, viewer.options);
        } catch (err) {
          console.error("Feed places failed:", err);
          return;
        }
        if (closed) return;
        if (onlyPlace) places = places.filter((entry) => entry.placeKey === onlyPlace);

        const wanted = new Set(places.map((entry) => entry.placeKey));
        const added = [];
        for (const key of wanted) {
          if (subscriptions.has(key)) continue;
          subscriptions.set(key, {
            rows: subscribeToPlace(key, sendRow),
            typing: subscribeToTyping(key, sendTyping),
          });
          added.push(key);
        }
        for (const [key, entry] of [...subscriptions]) {
          if (wanted.has(key)) continue;
          entry.rows();
          entry.typing();
          subscriptions.delete(key);
        }

        if (announce) write(`event: places\ndata: ${JSON.stringify({ places, reason })}\n\n`);
        if (catchUpNew && added.length > 0) await catchUp(added, lastSeq);
      };

      // The list first, so a client that reconnects knows what it is looking
      // at before any row lands. Then the catch-up, then the subscriptions —
      // in that order, because subscribing after the read would leave a gap a
      // row written in between could fall into. refreshPlaces subscribes, so
      // the catch-up runs against the list it just built.
      await refreshPlaces({ announce: true, reason: "open" });
      await catchUp([...subscriptions.keys()], since);

      // A presence change means the place list moved: their feet, a key, or
      // somebody letting them into a conversation. Serialised behind one
      // promise so two notifications in the same tick cannot interleave two
      // resubscribes.
      let queue = Promise.resolve();
      const unsubscribePresence = viewer.character
        ? subscribeToPresence(viewer.character.id, () => {
            queue = queue
              .then(() => refreshPlaces({ announce: true, catchUpNew: true, reason: "presence" }))
              .catch((err) => console.error("Feed presence refresh failed:", err));
          })
        : () => {};

      // The fifth event: a DirectMessage for this account, already shaped for
      // the player and already past the desk's noise filter (feedHub.js). No
      // cursor and no catch-up — the pane refetches its page on open and on a
      // reconnect (CHAT.md §2b). A GM with no character at all has a desk for
      // this; a ghost has nothing else, and it is where the word that they
      // have been buried, or brought back, arrives.
      //
      // `playing` and not just `character`: a GM reading from the GM seat has
      // their character withheld here on purpose (loadFeedViewer), but the DM
      // thread belongs to the ACCOUNT rather than the body — the same rule
      // Chat.js draws the Messages row by — so taking the watcher's chair must
      // not cost them their own mail.
      const unsubscribeDm = viewer.character || viewer.playing || viewer.options?.ghost
        ? subscribeToDm(viewer.discordUserId, (row) => {
            write(`event: dm\ndata: ${JSON.stringify(row)}\n\n`);
          })
        : () => {};

      // Railway's proxy closes an idle connection, and so do some corporate
      // ones. A comment line keeps it warm and costs nothing to parse.
      //
      // A ghost's stream also asks, on the same beat, whether they are still
      // one. Their list was decided once at open, and nothing above fires for
      // a viewer with no character — so a rite, a spawn, a reincarnation or a
      // re-roll would otherwise leave this connection reading every room in
      // the game, and writing into Deadchat, for as long as the tab stayed
      // open. The same one rule as loadFeedViewer (db/lib/ghost.js), one
      // indexed lookup every PING_MS; the moment it says no, the stream ends
      // and the reconnect opens as whoever they now are.
      //
      // Burial and engraving are NOT on that list any more — they lift the
      // curse and leave the seat alone (db/lib/ghost.js), so this fires less
      // often than it used to, not more.
      const ping = setInterval(() => {
        write(": ping\n\n");
        if (!viewer.options?.ghost) return;
        isPlayerGhost(prisma, viewer.discordUserId)
          .then((still) => {
            if (!still) finish();
          })
          .catch(() => {});
      }, PING_MS);
      ping.unref?.();

      const finish = () => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        unsubscribePresence();
        unsubscribeDm();
        for (const entry of subscriptions.values()) {
          entry.rows();
          entry.typing();
        }
        subscriptions.clear();
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      };

      finishStream = finish;
      if (request.signal.aborted) finish();
      else request.signal.addEventListener("abort", finish, { once: true });
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Nginx and Railway's proxy will otherwise buffer the stream and hold
      // every event until the connection closes, which is never.
      "X-Accel-Buffering": "no",
    },
  });
}
