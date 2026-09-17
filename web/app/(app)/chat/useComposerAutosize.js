"use client";

import { useLayoutEffect } from "react";

// The box grows with what is in it, to about six lines, and shrinks back. A
// DOM measurement after the value lands, so it is a layout effect and it sets
// no state — `rows` is only the floor (react-hooks/set-state-in-effect is an
// error in this repo).
//
// Shared because all three composers are one line at rest now, and a one-line
// box with no autosize scrolls a long message inside a single line rather than
// growing to hold it. The scene's box had this inline; Bascinet's pane and the
// GM's system box never did, and used a second row of height instead.
//
// `extra` is whatever else changes the box's shape — the scene passes its
// command chip, which puts a strip above the textarea.
export default function useComposerAutosize(ref, value, extra = null) {
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    // An empty box is one line, and CSS is what says how tall a line is (rows=1,
    // plus the touch floor). Measuring here instead would measure the
    // PLACEHOLDER: scrollHeight counts it, so on a narrow screen — where "Say
    // something in Supply Room…" wraps — an empty box reported 54px against a
    // 44px line and drew itself two lines tall before anybody had typed.
    if (!value) {
      el.style.height = "";
      return;
    }
    el.style.height = "auto";
    const line = parseFloat(getComputedStyle(el).lineHeight) || 20;
    el.style.height = `${Math.min(el.scrollHeight, Math.round(line * 6) + 12)}px`;
  }, [ref, value, extra]);
}
