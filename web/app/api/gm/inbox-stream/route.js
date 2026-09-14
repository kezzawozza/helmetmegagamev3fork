import { getGmSession } from "@/lib/discordGuild";
import { getInboxDelta } from "@/lib/inboxDelta";
import { deployVersion } from "@/lib/deployVersion";
import { subscribeToAllDms } from "@/lib/feedHub";

// GET /api/gm/inbox-stream — the player desk's live half, pushed instead of
// polled (replaces a 3s poll, PLAYER-DESK.md §9a). Payload is the same
// {nowMs, cursorMs, rail, thread} shape web/lib/inboxDelta.js has always
// produced; only the trigger moved to "when Postgres says a DirectMessage
// landed" (db/lib/dmNotify.js via feedHub.js's LISTEN). §9a's dropped-stream
// worry is answered three ways: a {resync:true} sentinel on pg reconnect
// (feedHub.js#resyncDm), the tab's own reconnect from its cursor, and a slow
// client backstop poll. Never cached, never prerendered — stays open as long
// as the tab does.
export const dynamic = "force-dynamic";

const PING_MS = 25_000;
// A burst raises one notification per row; coalescing saves running the CTE a hundred times.
const COALESCE_MS = 120;

export async function GET(request) {
  const { session, isGm } = await getGmSession();
  // 204 rather than 401 (matches /api/gm/inbox-delta): reads as "stop asking".
  if (!session?.discordUserId || !isGm) return new Response(null, { status: 204 });

  const gmDiscordUserId = session.discordUserId;
  const sinceParam = Number(new URL(request.url).searchParams.get("since"));
  const since = Number.isFinite(sinceParam) && sinceParam > 0 ? sinceParam : null;

  const encoder = new TextEncoder();

  let finishStream = () => {};
  const stream = new ReadableStream({
    cancel() {
      finishStream();
    },
    async start(controller) {
      let closed = false;
      // Postgres's clock, never the container's — inboxDelta.js's cursor
      // discipline rests on that.
      let cursorMs = since ?? 0;
      let timer = null;
      let running = false;
      // Set when a notification arrives while a delta is already in flight, so that run goes round again.
      let dirty = false;
      let unsubscribe = null;
      let ping = null;
      // Rows the hub handed us since the last frame, per conversation — lets
      // this stream serve EVERY conversation instead of one named in the URL.
      let pendingRows = new Map();

      // Declared and wired BEFORE the first await, or a consumer that
      // disconnects during it leaks the interval and the subscription.
      const finish = () => {
        if (closed) return;
        closed = true;
        clearInterval(ping);
        clearTimeout(timer);
        unsubscribe?.();
        try {
          controller.close();
        } catch {
          // Already closed by the runtime.
        }
      };
      finishStream = finish;
      if (request.signal.aborted) {
        finish();
        return;
      }
      request.signal.addEventListener("abort", finish, { once: true });

      // A failed enqueue means the consumer is gone. Must call finish(), NOT
      // just set `closed` — that would strand the ping interval and the
      // subscribeToAllDms callback for the life of the container.
      const write = (text) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          finish();
        }
      };

      // One frame: the rail delta, plus rows for any conversation since the
      // last frame. THERE IS NO `open` PARAMETER — shipping every touched
      // conversation's rows lets one connection last as long as the tab
      // rather than reconnecting per click. Failures are logged and
      // swallowed: the cursor stays put and the next notification (or the
      // client's backstop poll) picks up what this run missed.
      const pushDelta = async () => {
        if (closed) return;
        if (running) {
          dirty = true;
          return;
        }
        running = true;
        const rows = pendingRows;
        pendingRows = new Map();
        try {
          const delta = await getInboxDelta({
            gmDiscordUserId,
            sinceMs: cursorMs > 0 ? cursorMs : null,
          });
          if (closed) return;
          cursorMs = delta.cursorMs;
          const threads = [...rows.entries()].map(([discordUserId, messages]) => ({
            discordUserId,
            messages,
          }));
          write(
            `event: delta\ndata: ${JSON.stringify({ version: deployVersion(), ...delta, threads })}\n\n`,
          );
        } catch (err) {
          // Put the rows back so they ride the next frame.
          for (const [id, list] of rows) {
            pendingRows.set(id, [...(pendingRows.get(id) ?? []), ...list]);
          }
          console.error("Inbox stream delta failed:", err);
        } finally {
          running = false;
          if (dirty && !closed) {
            dirty = false;
            schedule();
          }
        }
      };

      // A function DECLARATION, not a const arrow: pushDelta's finally block refers to it.
      function schedule() {
        if (closed || timer) return;
        timer = setTimeout(() => {
          timer = null;
          void pushDelta();
        }, COALESCE_MS);
        timer.unref?.();
      }

      // Subscribe BEFORE the first delta, or a row landing in between is lost.
      unsubscribe = subscribeToAllDms((row) => {
        if (row?.resync) {
          // pg client dropped and came back; one delta fills the outage hole.
          schedule();
          return;
        }
        if (row?.discordUserId) {
          const list = pendingRows.get(row.discordUserId);
          if (list) list.push(row);
          else pendingRows.set(row.discordUserId, [row]);
        }
        schedule();
      });

      // Railway's proxy closes an idle connection; a comment line keeps it warm.
      ping = setInterval(() => write(": ping\n\n"), PING_MS);
      ping.unref?.();

      await pushDelta();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      // Otherwise Nginx/Railway buffer the stream until the connection closes.
      "X-Accel-Buffering": "no",
    },
  });
}
