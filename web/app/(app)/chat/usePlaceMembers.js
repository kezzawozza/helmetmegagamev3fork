"use client";

import { useCallback, useEffect, useState } from "react";
import { placeMembers } from "./actions";
import useVisiblePoll from "./useVisiblePoll";

// WHO IS IN this conversation or private room, and who could be let in.
//
// Lifted out of ./Feed.js so the rebuilt feed and the live one ask the same
// way (CHAT-REBUILD.md). It was already written once and read twice there —
// the members strip draws it, and `/remove`'s picker is the same list, and
// two fetches of it would be two answers to one question.

// Once a minute regardless of anything else. The strip learns about a change
// from the stream's `places` frame and from a message in this place, but
// neither fires for a key GRANTED to somebody else while nobody is talking —
// there is no frame for that at all — so the list could sit wrong for as long
// as the room stayed quiet. A minute is slow enough to cost nothing and quick
// enough that nobody notices they waited.
const MEMBERS_REFRESH_MS = 60_000;

export default function usePlaceMembers(place, placesVersion = 0) {
  const placeKey = place?.placeKey ?? null;
  // Only two kinds of place have a guest list at all: a conversation, and a
  // PRIVATE room. Asked about anywhere else, placeMembers() answers with a
  // null `members` rather than a refusal — but not asking is cheaper.
  const hasMembers = place?.kind === "conv" || (place?.kind === "room" && place?.roomKind === "PRIVATE");

  const [members, setMembers] = useState(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    if (!hasMembers || !placeKey) return undefined;
    let cancelled = false;
    placeMembers(placeKey)
      .then((res) => {
        // STAMPED with the place it answers for. The state outlives a walk
        // across town, and an unstamped answer would draw the last room's
        // guest list over this one's for a frame.
        if (!cancelled) setMembers({ placeKey, res });
      })
      .catch(() => {
        if (!cancelled) setMembers({ placeKey, res: { ok: false, error: "Couldn't read who is in here." } });
      });
    return () => {
      cancelled = true;
    };
  }, [hasMembers, placeKey, nonce, placesVersion]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  useVisiblePoll(reload, MEMBERS_REFRESH_MS, { enabled: Boolean(hasMembers && placeKey) });

  return { hasMembers, data: members?.placeKey === placeKey ? members.res : null, reload };
}
