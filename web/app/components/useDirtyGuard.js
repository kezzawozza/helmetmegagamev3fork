"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useConfirm } from "./ConfirmProvider";

// Guards a panel with unsaved edits. Two layers: guardedClose() covers
// in-app exits, a beforeunload listener covers browser-level ones. The
// browser dialog's wording is fixed by the user agent, only whether it
// appears is ours. Module-level counter answers "is ANYTHING dirty right
// now" cross-component, for the live-refresh poll on /gm/turns.
let dirtyInstances = 0;
export function isAnyDirty() {
  return dirtyInstances > 0;
}

// `initialDirty`: opens ALREADY holding unsaved content. `alsoDirty`: unsaved
// content OUTSIDE this hook (deskDraft.js), ORed into `dirty`, counted by its
// own effect below. `alsoDirtyHoldsPoll`: a restored draft is guarded on
// close regardless, but only holds the 120s backstop poll while someone is actively writing.
export default function useDirtyGuard({
  enabled = true,
  initialDirty = false,
  alsoDirty = false,
  alsoDirtyHoldsPoll = true,
} = {}) {
  const confirm = useConfirm();
  const [selfDirty, setDirty] = useState(initialDirty);
  const dirty = selfDirty || alsoDirty;
  const dirtyRef = useRef(initialDirty);
  // Single source of truth for whether this instance's 1 is counted, so
  // registering/marking/unmounting can never double-count.
  const counted = useRef(false);

  // Counter mutations stay OUT of setState updaters: React may call an
  // updater twice (StrictMode, concurrent transition), which must never
  // drive dirtyInstances below this instance's real contribution.
  const markDirty = useCallback(() => {
    dirtyRef.current = true;
    if (!counted.current) {
      counted.current = true;
      dirtyInstances += 1;
    }
    setDirty(true);
  }, []);
  const markClean = useCallback(() => {
    dirtyRef.current = false;
    if (counted.current) {
      counted.current = false;
      dirtyInstances = Math.max(0, dirtyInstances - 1);
    }
    setDirty(false);
  }, []);

  // Register an initially-dirty contribution and drop it on unmount, so it can't leave the counter stuck positive.
  useEffect(() => {
    if (dirtyRef.current && !counted.current) {
      counted.current = true;
      dirtyInstances += 1;
    }
    return () => {
      if (counted.current) {
        counted.current = false;
        dirtyInstances = Math.max(0, dirtyInstances - 1);
      }
    };
  }, []);

  useEffect(() => {
    if (!alsoDirty || !alsoDirtyHoldsPoll) return undefined;
    dirtyInstances += 1;
    return () => {
      dirtyInstances = Math.max(0, dirtyInstances - 1);
    };
  }, [alsoDirty, alsoDirtyHoldsPoll]);

  useEffect(() => {
    if (!enabled || !dirty) return undefined;
    const onBeforeUnload = (e) => {
      e.preventDefault();
      e.returnValue = ""; // legacy browsers require this to show the prompt
      return "";
    };
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => window.removeEventListener("beforeunload", onBeforeUnload);
  }, [enabled, dirty]);

  const guardedClose = useCallback(
    async (onClose) => {
      if (dirty) {
        const ok = await confirm({
          title: "Discard your changes?",
          message: "This panel has unsaved edits. Closing reverts every change you've made.",
          confirmLabel: "Discard",
          cancelLabel: "Keep editing",
        });
        if (!ok) return false;
      }
      markClean();
      onClose?.();
      return true;
    },
    [confirm, dirty, markClean],
  );

  return { dirty, markDirty, markClean, guardedClose };
}
