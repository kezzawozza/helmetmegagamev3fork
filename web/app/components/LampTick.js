"use client";

import { useEffect } from "react";
import { LAMP_TICK_MS, THEMES, resolveLook } from "@/lib/clockTheme";

// Keeps <html>'s data-theme and --lamp in step with the Chicago clock for a
// tab that stays open — including across 18:00, where the look hard-switches.
//
// Writes the DOM imperatively and holds NO state, which is the whole design:
//
//  * No setState, so react-hooks/set-state-in-effect (an error in this repo)
//    never comes up, and a five-minute timer never re-renders the app.
//  * No render-time clock read, so there is nothing for the server and the
//    client to disagree about. The values in the HTML come from the server's
//    own call to resolveLook (layout.js); this only edits them afterwards.
//    A useSyncExternalStore version would have had to re-read the clock during
//    hydration and could land a different answer across a minute boundary.
//
// The re-read on visibilitychange is for a laptop that slept: background
// timers are throttled or suspended, so a tab woken at 20:00 must not still be
// wearing the afternoon's lamp until the next tick.
export default function LampTick({ override }) {
  useEffect(() => {
    if (THEMES.includes(override)) return; // BASCINET_THEME is pinned: no gradient, no timer
    const apply = () => {
      const { theme, lamp } = resolveLook(override);
      const root = document.documentElement;
      if (root.dataset.theme !== theme) root.dataset.theme = theme;
      root.style.setProperty("--lamp", String(lamp));
    };
    apply();
    const id = setInterval(apply, LAMP_TICK_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") apply();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [override]);
  return null;
}
