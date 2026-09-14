"use client";

// The Move a player is part-way through typing, kept in this browser until filed — the
// server must not hold half a Move that was never filed. Keyed by character AND turn.
// Every accessor is wrapped: a private window or blocked site data throws on the accessor itself.

const PREFIX = "chat:move-draft:";

function keyFor(characterId, turnNumber) {
  if (characterId == null || turnNumber == null) return null;
  return `${PREFIX}${characterId}:${turnNumber}`;
}

export function readDraft(characterId, turnNumber) {
  const key = keyFor(characterId, turnNumber);
  if (!key) return "";
  try {
    return window.localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}

export function writeDraft(characterId, turnNumber, text) {
  const key = keyFor(characterId, turnNumber);
  if (!key) return;
  try {
    if (text) window.localStorage.setItem(key, text);
    else window.localStorage.removeItem(key);
  } catch {
    // The box still holds the words for this session; it just forgets.
  }
}

// Called once the Move is filed. Also sweeps drafts left behind by earlier turns.
export function clearDraft() {
  try {
    const stale = [];
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i);
      if (key?.startsWith(PREFIX)) stale.push(key);
    }
    for (const key of stale) window.localStorage.removeItem(key);
  } catch {
    // Nothing to clean up that we can reach.
  }
}
