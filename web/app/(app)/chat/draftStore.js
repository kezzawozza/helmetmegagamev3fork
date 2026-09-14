"use client";

// What's typed into the composer and not sent, per place, for the life of the tab — put back the next time that
// place opens, like Discord's per-channel draft. Module state on purpose, no listeners: Feed reads it in a state
// initializer on mount and writes it from an effect as the draft changes.

const drafts = new Map();

export function readDraft(placeKey) {
  return (placeKey && drafts.get(placeKey)) || "";
}

export function writeDraft(placeKey, text) {
  if (!placeKey) return;
  if (text) drafts.set(placeKey, text);
  else drafts.delete(placeKey);
}
