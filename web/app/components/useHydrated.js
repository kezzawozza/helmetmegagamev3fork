"use client";

import { useSyncExternalStore } from "react";

// False during server render and hydration, true after — lets a component render one thing for hydration and a
// better thing immediately after, with no suppressHydrationWarning (which tells React never to fix the text) and no
// effect (react-hooks/set-state-in-effect is an error here). Same discipline as Modal.js and usePins.js.
const subscribe = () => () => {};
const onClient = () => true;
const onServer = () => false;

export default function useHydrated() {
  return useSyncExternalStore(subscribe, onClient, onServer);
}
