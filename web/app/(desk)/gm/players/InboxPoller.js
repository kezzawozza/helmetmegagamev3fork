"use client";

import useGatedRefreshPoll from "@/app/components/useGatedRefreshPoll";

const REFRESH_MS = 30_000;

// Live inbox refresh — the shared gated poll (useGatedRefreshPoll.js):
// skipped while hidden, a modal is open, or edits are unsaved, and
// version-gated so a refresh never crosses a deploy boundary.
export default function InboxPoller({ deployVersion }) {
  useGatedRefreshPoll(REFRESH_MS, deployVersion);
  return null;
}
