"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useTransition } from "react";
import { useRouter } from "next/navigation";
import { checkDeskVersion, isDeskStale, setDeskBaseline } from "./useDeskVersion";

const RefreshContext = createContext(null);

// The owning transition must outlive the refresh, so this is mounted in the root layout, above every loading.js boundary.
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

// Won't cross a deploy boundary; skips if the stale latch is set, otherwise
// checks the running build. RETURNS A PROMISE FOR WHETHER IT REFRESHED, always.
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

// Wraps a desk so EVERY useRefresh() under it skips across a deploy boundary.
export function DeskStaleRefreshGate({ version = null, children }) {
  const [refresh, refreshing] = useRefresh();
  useEffect(() => {
    setDeskBaseline(version);
  }, [version]);
  const guarded = useCallback(() => safeRefresh(version, refresh), [refresh, version]);
  const value = useMemo(() => [guarded, refreshing], [guarded, refreshing]);
  return <RefreshContext.Provider value={value}>{children}</RefreshContext.Provider>;
}

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
