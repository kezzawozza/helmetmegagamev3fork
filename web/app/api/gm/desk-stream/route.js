import { getGmSession } from "@/lib/discordGuild";
import { deskPatchFor } from "@/lib/deskRows";
import { deployVersion } from "@/lib/deployVersion";
import { subscribeToDesk } from "@/lib/feedHub";

// GET /api/gm/desk-stream — the adjudication desk's live half, so another
// GM's staging/lock/Reject arrives without a refetch. Shape mirrors the
// player desk's inbox stream (api/gm/inbox-stream/route.js), but carries
// nothing but ids (db/lib/deskNotify.js) and re-reads a whole beat in ONE
// deskPatchFor() call. NO ZONE GATE, deliberately — the queue rail filters
// client-side (Workspace.js), so a widened-zone click must find rows already
// there. Never cached, never prerendered.
export const dynamic = "force-dynamic";

const PING_MS = 25_000;
// Longer than the inbox's 120ms: the desk's bursts (a push touching everything) are bigger.
const COALESCE_MS = 250;

const TYPES = {
  move: "moveIds",
  caving: "cavingRollIds",
  effect: "stagedEffectIds",
  message: "stagedMessageIds",
};

export async function GET(request) {
  const { session, isGm } = await getGmSession();
  // 204 rather than 401 (matches the inbox stream): reads as "stop asking".
  if (!session?.discordUserId || !isGm) return new Response(null, { status: 204 });

  const encoder = new TextEncoder();

  let finishStream = () => {};
  const stream = new ReadableStream({
    cancel() {
      finishStream();
    },
    async start(controller) {
      let closed = false;
      let timer = null;
      let running = false;
      // Set when a notification arrives while a patch is already in flight, so that run goes round again.
      let dirty = false;
      let unsubscribe = null;
      let ping = null;
      // Ids named since the last frame, per type. Sets, so a row written five times in one beat is read once.
      let pending = newPending();
      let resyncPending = false;

      function newPending() {
        return { move: new Set(), caving: new Set(), effect: new Set(), message: new Set() };
      }

      // Declared and wired BEFORE the first await, or a disconnecting consumer leaks the interval/subscription.
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
      // subscribeToDesk callback for the life of the container.
      const write = (text) => {
        if (closed) return;
        try {
          controller.enqueue(encoder.encode(text));
        } catch {
          finish();
        }
      };

      // One frame: every id named since the last one, re-read via deskPatchFor.
      // `onDeskOnly` keeps a turn-end push from dealing last turn's Moves onto
      // an open queue (web/lib/deskRows.js). A row the hub called "gone" is
      // NOT sent as a removal here — deskPatchFor reports missing ids as
      // removed instead. Failures are logged and swallowed, ids put back.
      const pushPatch = async () => {
        if (closed) return;
        if (running) {
          dirty = true;
          return;
        }
        running = true;
        const batch = pending;
        pending = newPending();
        const wasResync = resyncPending;
        resyncPending = false;
        try {
          if (wasResync) write(`event: resync\ndata: ${JSON.stringify({ version: deployVersion() })}\n\n`);
          const ids = {};
          let any = false;
          for (const [type, field] of Object.entries(TYPES)) {
            ids[field] = [...batch[type]];
            if (ids[field].length) any = true;
          }
          if (!any) return;
          const patch = await deskPatchFor({ ...ids, onDeskOnly: true });
          if (closed) return;
          write(`event: desk\ndata: ${JSON.stringify({ version: deployVersion(), ...patch })}\n\n`);
        } catch (err) {
          for (const type of Object.keys(TYPES)) {
            for (const id of batch[type]) pending[type].add(id);
          }
          console.error("Desk stream patch failed:", err);
        } finally {
          running = false;
          if (dirty && !closed) {
            dirty = false;
            schedule();
          }
        }
      };

      // A function DECLARATION, not a const arrow: pushPatch's finally block refers to it.
      function schedule() {
        if (closed || timer) return;
        timer = setTimeout(() => {
          timer = null;
          void pushPatch();
        }, COALESCE_MS);
        timer.unref?.();
      }

      unsubscribe = subscribeToDesk((event) => {
        if (event?.resync) {
          // pg client dropped and came back; a patch is a list of ids, not a
          // window in time, so the tab is told to refetch the page instead.
          resyncPending = true;
          schedule();
          return;
        }
        const bucket = event?.t && pending[event.t];
        if (!bucket) return;
        bucket.add(String(event.id));
        schedule();
      });

      // Railway's proxy closes an idle connection; a comment line keeps it warm.
      ping = setInterval(() => write(": ping\n\n"), PING_MS);
      ping.unref?.();

      // Opening frame so EventSource fires `open` when the route accepts, not at the first write.
      write(": open\n\n");
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
