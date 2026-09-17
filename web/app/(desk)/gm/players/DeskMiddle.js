"use client";

import { useEffect } from "react";
import { useSelection, selectConversation } from "./selection";
import {
  useThread,
  getThread,
  noteLoading,
  noteReady,
  noteError,
} from "./threadStore";
import PersonShell from "./conversation/PersonShell";
import ConversationSkeleton from "./conversation/Skeleton";

// The desk's middle column: the roster, with a conversation drawn over it
// when one is open. `children` is the roster route, the desk's only route,
// staying mounted the whole time — closing a conversation is instant since
// the roster is already there, search/sort/scroll intact. Opening somebody
// is a fetch, not a navigation, so it can be ABORTED — click three people
// quickly and the first two are dropped rather than each running to completion.
export default function DeskMiddle({ children, rows, gmProfiles, myDiscordUserId }) {
  const selected = useSelection();
  const entry = useThread(selected);
  // The roster's own row for whoever is open, refreshed on the desk's 30s
  // router.refresh() poll. Compared against the cached thread below so a
  // respawn — a new character taking over this discordUserId — evicts the
  // header threadStore would otherwise hold onto forever (it has no TTL of
  // its own; see threadStore.js). `null` for someone with no character at all.
  const currentCharacterId = rows?.find((r) => r.discordUserId === selected)?.characterId ?? null;

  useEffect(() => {
    if (!selected) return undefined;
    const cached = getThread(selected);
    // Already loaded AND still the same character: draw it and ask for
    // nothing — the cache paying off. A changed characterId (a death and a
    // new character under the same account) means the cached label/status/
    // avatar are for somebody who is no longer who this account plays.
    if (cached?.status === "ready" && cached.payload?.characterId === currentCharacterId) {
      return undefined;
    }

    const controller = new AbortController();
    noteLoading(selected);
    (async () => {
      try {
        const res = await fetch(
          `/api/gm/thread?user=${encodeURIComponent(selected)}`,
          {
            cache: "no-store",
            signal: controller.signal,
          },
        );
        if (controller.signal.aborted) return;
        if (res.status === 204) {
          noteError(
            selected,
            "You are not signed in as a GM any more. Reload the page.",
          );
          return;
        }
        if (res.status === 404) {
          noteError(selected, "There is nobody by that id.");
          return;
        }
        if (!res.ok) {
          noteError(selected, "The conversation could not be loaded.");
          return;
        }
        const payload = await res.json();
        if (controller.signal.aborted) return;
        noteReady(selected, payload);
      } catch (err) {
        // An abort is the ordinary case — the GM moved on, not an error to show.
        if (controller.signal.aborted || err?.name === "AbortError") return;
        noteError(selected, "The conversation could not be loaded.");
      }
    })();

    return () => controller.abort();
  }, [selected, currentCharacterId]);

  // The roster is HIDDEN, never unmounted, so opening somebody and coming
  // back never resets the search/filters/sort/selection. The wrapper is
  // display:contents while shown, so desk-main is still the grid's own
  // column; hidden, it drops out of layout and the conversation takes its place.
  return (
    <>
      <div className="desk-hideable" hidden={!!selected}>
        {children}
      </div>
      {selected ? body() : null}
    </>
  );

  function body() {
    // A payload we already had stays on screen while a refetch is in flight, so reopening never flashes empty.
    if (entry?.payload) {
      return (
        <PersonShell
          // Keyed on the conversation: the pane seeds local state from its
          // props, so switching person has to be a remount.
          key={selected}
          {...entry.payload}
          // The route answers in REST shape (`messages`/`hasMore`); the pane
          // copies them into state as `initial*` once — spreading alone left both undefined.
          initialMessages={entry.payload.messages}
          initialHasMore={entry.payload.hasMore}
          gmProfiles={gmProfiles}
          myDiscordUserId={myDiscordUserId}
        />
      );
    }

    if (entry?.status === "error") {
      // Own error state, not components/ErrorPanel (a second DeskHeader).
      // error.js covers a render THROW; this covers a failed fetch, which no boundary can see.
      return (
        <div className="desk-person">
          <div className="panel m-3 flex flex-col items-start gap-3 p-4">
            <p className="text-sm text-muted">{entry.error}</p>
            <button
              type="button"
              className="btn"
              onClick={() => {
                // Clearing and re-selecting is what re-runs the effect above.
                const id = selected;
                selectConversation(null, { replace: true });
                selectConversation(id, { replace: true });
              }}
            >
              Try again
            </button>
          </div>
        </div>
      );
    }

    return <ConversationSkeleton />;
  }
}
