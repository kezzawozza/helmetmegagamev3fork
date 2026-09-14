// What a DM's buttons ARE, written down once so both faces draw the same
// pair. A button here is a VIEW OF A PENDING ROW — the DM records only which
// row it's about and the web derives the rest, so a button can't outlive the
// thing it answers and the two faces can't draw a different pair (web-only
// players otherwise had no way to answer a Discord-only component). Written
// into `meta.action` — a key INSIDE meta, never meta itself, since the Bird's
// delivery DM already stores `meta.paper` and a call site with its own meta
// must merge rather than replace. Not on the @lifeweb/db barrel; require it
// by path (db/lib/dm.js convention).

const DM_ACTION = Object.freeze({
  OFFER: "OFFER",
  THREAT_SPAWN: "THREAT_SPAWN",
  LOBBY_SEAT: "LOBBY_SEAT",
  KEYED_WAY: "KEYED_WAY",
  // Odd one out: a view of a live hold (Character.heldUntil), not an Offer —
  // the initiator answers this one, not a responder (INTERCEPT.md).
  INTERCEPT_HOLD: "INTERCEPT_HOLD",
  // Same odd shape as INTERCEPT_HOLD: initiator answers, replacing that
  // button on an ambusher's DM since breaking off now unpicks BOTH holds (ATTACK.md).
  ATTACK_HOLD: "ATTACK_HOLD",
  // A tax filed against you (docs/tags.yaml's `taxman`, db/lib/tax.js). Only one answer exists —
  // doing nothing IS the accept.
  PENDING_TAX: "PENDING_TAX",
  // Draws NO generic button row (BIRD.md): answering a letter is a picker,
  // not an Accept, so the web draws its own Reply on the letter card
  // (DmThread.js#LetterBody). Still a descriptor: the row records it ASKS
  // something, the liveness resolver refuses a stale letter, and DmThread
  // won't collapse it into "3 automated messages".
  BIRD_REPLY: "BIRD_REPLY",
});

// Every family reads as one of these even where Discord labels differ (escort "Cancel", keyed way "No").
const DM_CHOICE = Object.freeze({ ACCEPT: "accept", DECLINE: "decline", PARTIAL: "partial" });

// What the web draws, matching the Discord row builders (offerRow.js, threatSpawn.js, lobby.js,
// locationAnchorRow.js), kept beside the kinds so a relabel is a one-line change on both.
// `decline: null` means no decline button at all.
const DM_ACTION_LABELS = Object.freeze({
  [DM_ACTION.OFFER]: { accept: "Accept", decline: "Decline" },
  // Same row builder, different words: an escort is called off, not refused.
  ESCORT: { accept: "Accept", decline: "Cancel" },
  [DM_ACTION.THREAT_SPAWN]: { accept: "Accept", decline: "Decline" },
  [DM_ACTION.LOBBY_SEAT]: { accept: null, decline: "Decline the seat" },
  [DM_ACTION.KEYED_WAY]: { accept: "Yes", decline: "No" },
  // One button, and it is the accept — the LOBBY_SEAT shape, the other way up.
  [DM_ACTION.INTERCEPT_HOLD]: { accept: "Release", decline: null },
  [DM_ACTION.ATTACK_HOLD]: { accept: "Cancel attack", decline: null },
  // `partial` asks for a number — only a tax has one (db/lib/tax.js#payPartialTax).
  [DM_ACTION.PENDING_TAX]: { accept: null, decline: "Refuse", partial: "Partial" },
  // No entry for BIRD_REPLY, and that is deliberate — see the kind above.
});

// The descriptor a sendDm call site spreads into `meta`. `variant` says which label set to draw
// ("ESCORT" today, nothing else): sendDm(id, text, { components: offerButtonRow(offer.id), meta: dmAction(DM_ACTION.OFFER, offer.id) })
function dmAction(kind, id, variant = null) {
  if (!DM_ACTION[kind]) throw new Error(`Unknown DM action kind: ${kind}`);
  return { action: variant ? { kind, id: String(id), variant } : { kind, id: String(id) } };
}

// Returns null for anything unknown, so an old row from a newer deploy draws no buttons rather than throwing.
function dmActionLabels(action) {
  if (!action?.kind) return null;
  return DM_ACTION_LABELS[action.variant] ?? DM_ACTION_LABELS[action.kind] ?? null;
}

// One reader of a DirectMessage row, so the shape of `meta` is known in one place.
function dmActionOf(row) {
  const action = row?.meta?.action;
  if (!action?.kind || !action?.id) return null;
  if (!DM_ACTION[action.kind]) return null;
  return action;
}

module.exports = { DM_ACTION, DM_CHOICE, DM_ACTION_LABELS, dmAction, dmActionLabels, dmActionOf };
