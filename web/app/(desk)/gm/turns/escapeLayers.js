"use client";

import { useEffect, useRef } from "react";

// The desk's Escape stack.
//
// Escape on the adjudication desk means "back out of the innermost thing I
// opened". Workspace.js owns the outermost layer — deselecting the Move — and
// Modal.js owns a dialog that currently holds focus. Between those two sat a
// hole: a MODELESS composer (EffectComposer and friends) that the GM has
// clicked away from deliberately deselects itself out of Modal's handler
// (`floatingRef` bails when focus is elsewhere), so the keypress fell straight
// through to Workspace and took the whole Move with it — composer, Result box
// and all.
//
// So a composer registers a layer while it is open. Workspace asks this first:
// if anything is stacked, the topmost one closes and the selection is left
// alone. A second Escape then does what the first used to.
//
// A module-level stack, not context, because the composers are rendered from
// three different parents (MoveDesk, CavingDesk, StagingTray, and StagedItems'
// edit rows) and prop-drilling a register callback through all of them is how
// one of them would quietly end up without it.

const layers = [];

function pushEscapeLayer(fn) {
  const token = { fn };
  layers.push(token);
  return () => {
    const i = layers.indexOf(token);
    if (i !== -1) layers.splice(i, 1);
  };
}

// Runs the topmost layer, if there is one. Returns whether it did, so the
// caller knows whether to go on to its own handling.
export function runTopEscapeLayer() {
  const token = layers[layers.length - 1];
  if (!token) return false;
  token.fn();
  return true;
}

// The hook form. `fn` is read through a ref so a composer re-rendering on
// every keystroke does not tear the layer down and push it back on — which
// would reorder the stack under a nested dialog.
export default function useEscapeLayer(fn, enabled = true) {
  const ref = useRef(fn);
  useEffect(() => {
    ref.current = fn;
  });
  useEffect(() => {
    if (!enabled) return undefined;
    return pushEscapeLayer(() => ref.current?.());
  }, [enabled]);
}
