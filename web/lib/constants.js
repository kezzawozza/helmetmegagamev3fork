export const APPEARANCE_MAX_LENGTH = 400;

// The biggest photo a player may upload. Both sides check it: updateCharacterProfile is the real
// gate, AvatarField refuses client-side first. Read the bodySizeLimit note in next.config.mjs before
// raising it — the action body limit must stay above this.
export const MAX_AVATAR_UPLOAD_BYTES = 5 * 1024 * 1024;

// Longest edge the browser shrinks a picture to before posting (lib/shrinkImage.js); 4x the 256 the
// server stores, for cover-crop headroom.
export const MAX_AVATAR_UPLOAD_EDGE = 1024;

// Below this, a picture already within MAX_AVATAR_UPLOAD_EDGE posts untouched — a lossy round-trip
// would only cost quality.
export const SHRINK_SKIP_BELOW_BYTES = 512 * 1024;

// Sanity cap refused WITHOUT decoding, so an absurd file can't lock the tab up before any check speaks.
export const MAX_AVATAR_PICK_BYTES = 50 * 1024 * 1024;

// One owner for the refusal sentence — pick-time and upload caps differ, so both callers use this.
export function avatarTooBigMessage(bytes, limit = MAX_AVATAR_UPLOAD_BYTES) {
  const mb = (bytes / 1024 / 1024).toFixed(1);
  return `That image is ${mb}MB. It has to be under ${Math.round(limit / 1024 / 1024)}MB.`;
}

// Lives here, not lib/requests.js, because RequestDialog is a client component and requests.js drags
// @lifeweb/db into the browser bundle (see lib/formatTagRequirement.js).
export const MAX_REASON_LENGTH = 500;

// GM-authored message length across every composer (staged, broadcast, per-row, /gm/messages, Dev
// Panel). Not Discord's 2000-char limit — chunkMessage (db/lib/chunkText.js) splits across several
// messages — this is how much a GM may stage before they should split it themselves. Not a truncation
// point: composers show the count and refuse to stage over it.
export const GM_MESSAGE_MAX_LENGTH = 6000;

// What a player may write to Bascinet from Chat in one go (DmPane.js) — Discord's own DM ceiling.
export const PLAYER_DM_MAX_LENGTH = 2000;

// The Move Result box (Action.resultMessage) — GM-facing canon never sent to Discord, so no
// Discord-shaped cap; bounded only against a runaway paste.
export const RESULT_BOX_MAX_LENGTH = 12000;

// A player's private Journal entry (/notes) — generous but capped against a runaway paste.
export const JOURNAL_TITLE_MAX_LENGTH = 120;
export const JOURNAL_BODY_MAX_LENGTH = 8000;
export const JOURNAL_LABEL_MAX_LENGTH = 24;
export const JOURNAL_MAX_LABELS = 8;

// Headstone-carving cost (CORPSES.md). Mirrors db/lib/constants.js#ENGRAVE_RESOURCE_COST rather than
// importing it — this "use client" module never reaches into @lifeweb/db. Change both together.
export const ENGRAVE_RESOURCE_COST = 4;
