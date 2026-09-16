export const APPEARANCE_MAX_LENGTH = 400;

// Read the bodySizeLimit note in next.config.mjs before raising it — the action body limit must stay above this.
export const MAX_AVATAR_UPLOAD_BYTES = 5 * 1024 * 1024;

export const MAX_AVATAR_UPLOAD_EDGE = 1024;

export const SHRINK_SKIP_BELOW_BYTES = 512 * 1024;

export const MAX_AVATAR_PICK_BYTES = 50 * 1024 * 1024;

export function avatarTooBigMessage(bytes, limit = MAX_AVATAR_UPLOAD_BYTES) {
  const mb = (bytes / 1024 / 1024).toFixed(1);
  return `That image is ${mb}MB. It has to be under ${Math.round(limit / 1024 / 1024)}MB.`;
}

export const MAX_REASON_LENGTH = 500;

export const GM_MESSAGE_MAX_LENGTH = 6000;

export const PLAYER_DM_MAX_LENGTH = 2000;

// GM-facing canon never sent to Discord, so no Discord-shaped cap; bounded only against a runaway paste.
export const RESULT_BOX_MAX_LENGTH = 12000;

export const JOURNAL_TITLE_MAX_LENGTH = 120;
export const JOURNAL_BODY_MAX_LENGTH = 8000;
export const JOURNAL_LABEL_MAX_LENGTH = 24;
export const JOURNAL_MAX_LABELS = 8;

// Mirrors db/lib/constants.js#ENGRAVE_RESOURCE_COST — this "use client" module never reaches into @lifeweb/db. Change both together.
export const ENGRAVE_RESOURCE_COST = 4;

// One AdminNote. A moderation note is a line or two about what somebody did,
// not a report -- and it is append-only, so a long one cannot be trimmed later.
export const ADMIN_NOTE_MAX_LENGTH = 2000;
