"use client";

import { createContext, useContext, useMemo } from "react";

// Deliberately NOT mounted in the root layout, unlike TagsProvider and its siblings. Only /chat and /notes render
// a {char:…} token, so the default empty Map means an unresolved token elsewhere just draws its neutral chip — mounting this provider can never regress a page that doesn't use it.
const CharacterMentionsContext = createContext(new Map());

export function useCharacterMentions() {
  return useContext(CharacterMentionsContext);
}

// Two lists: `characters` — the @ menu's list, the people here, wins on collision (carries the avatar path
// whosHere() resolved) — and `directory` — every character whose name is safe to print, so a ping of somebody
// elsewhere still renders as a person. Both `{ id, name, updatedAt, avatarPath }[]` (web/lib/mentionDirectory.js).
export default function CharacterMentionsProvider({ characters = [], directory = [], children }) {
  const mentionsById = useMemo(() => {
    const map = new Map();
    for (const c of directory) map.set(c.id, c);
    for (const c of characters) map.set(c.id, c);
    return map;
  }, [characters, directory]);
  return <CharacterMentionsContext.Provider value={mentionsById}>{children}</CharacterMentionsContext.Provider>;
}
