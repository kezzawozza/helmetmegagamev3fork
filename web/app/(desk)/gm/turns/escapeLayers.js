"use client";

import { useEffect, useRef } from "react";

// The desk's Escape stack: Workspace.js owns the outermost layer
// (deselecting the Move), Modal.js owns a focused dialog. A MODELESS
// composer (EffectComposer and friends) registers a layer while open, so
// Escape closes the topmost one first instead of falling through to
// Workspace and taking the whole Move with it. Module-level, not context,
// because composers render from three different parents (MoveDesk,
// CavingDesk, StagingTray, StagedItems' edit rows).

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
