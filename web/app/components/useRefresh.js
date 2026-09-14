"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { checkDeskVersion, isDeskStale, setDeskBaseline } from "./useDeskVersion";

const RefreshContext = createContext(null);

// router.refresh() outside a transition drops React to the route's
// loading.js fallback for the length of the refetch — a visible blackout on
// a full-viewport desk. Wrapping it in a transition avoids that, but the
// transition must be OWNED by something that outlives the refresh: a
// component that owns it and is then unmounted by that same refresh brings
// the fallback back and remounts the whole client tree, losing local state.
// RefreshProvider is mounted in the root layout, above every loading.js
// boundary, so no caller can orphan the transition.
export function RefreshProvider({ children }) {
  const router = useRouter();
  const [refreshing, startTransition] = useTransition();
  const refresh = useCallback(() => {
    startTransition(() => {
      router.refresh();
    });
  }, [router]);
  const value = useMemo(() => [refresh, refreshing], [refresh, refreshing]);
  return <RefreshContext.Provider value={value}>{children}</RefreshContext.Provider>;
}

// A router.refresh() that will not cross a deploy boundary.
//
// Next discards an RSC payload built by a different build and falls back to a
// full browser navigation — which on a desk is the reload that eats whatever
// the GM was in the middle of. The stale latch (useDeskVersion.js) catches
// that once a poll has noticed, but between a deploy landing and the next
// tick every post-mutation refresh() was unguarded. So ask first: skip
// outright if the latch is already set, otherwise check the running build and
// refresh only on a match.
//
// RETURNS A PROMISE FOR WHETHER IT REFRESHED, always — the deferred branch
// used to drop its promise on the floor, so a caller could neither wait for
// the check nor find out that it had said no. `refresh` is itself the
// provider's transition-wrapping callback (RefreshProvider), so the deferred
// call is inside the same owned transition the immediate one is; what was
// missing was only the outcome.
export function safeRefresh(baseline, refresh) {
  if (isDeskStale()) return Promise.resolve(false);
  if (!baseline) {
    refresh();
    return Promise.resolve(true);
  }
  return checkDeskVersion(baseline).then((outcome) => {
    if (outcome !== "ok") return false;
    refresh();
    return true;
  });
}

// Wraps a desk in a RefreshGate keyed on the stale latch and on the running
// build, so EVERY useRefresh() under it — the post-mutation ones included —
// skips rather than refreshing across a deploy boundary. A component rather
// than a bare prop because server layouts can't pass a function to a client
// component; this one imports its own guard.
export function DeskStaleRefreshGate({ version = null, children }) {
  const [refresh, refreshing] = useRefresh();
  // Remembered for noteActionVersion(), which judges a mutation's result
  // without the version being drilled to the call site.
  useEffect(() => {
    setDeskBaseline(version);
  }, [version]);
  const guarded = useCallback(() => safeRefresh(version, refresh), [refresh, version]);
  const value = useMemo(() => [guarded, refreshing], [guarded, refreshing]);
  return <RefreshContext.Provider value={value}>{children}</RefreshContext.Provider>;
}

// Returns [refresh, refreshing]. Prefers the shared provider's transition;
// the local one is only a fallback for a tree mounted outside the provider.
export function useRefresh() {
  const shared = useContext(RefreshContext);
  const router = useRouter();
  const [localRefreshing, startTransition] = useTransition();
  const localRefresh = useCallback(() => {
    startTransition(() => {
      router.refresh();
    });
  }, [router]);
  const local = useMemo(() => [localRefresh, localRefreshing], [localRefresh, localRefreshing]);
  return shared ?? local;
}
