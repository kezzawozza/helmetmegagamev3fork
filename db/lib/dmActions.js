// What a DM's buttons ARE, written down once so both faces draw the same pair.
//
// A DM that carries Discord components (an offer's Accept/Decline, a seat's
// Decline, the keyed way's Yes/No) used to be answerable on Discord alone: all
// three sendDm twins forward `opts.components` to Discord but log only
// `content` to DirectMessage, so nothing on the web ever learned a button
// existed. A web-only player read the offer and had no way to answer it --
// which matters most for exactly the people who have no other face
// (web/app/(app)/chat/page.js, the characterless branch).
//
// The fix is not to persist Discord's component JSON. A button here is a VIEW
// OF A PENDING ROW, so the DM records only which row it is about and the web
// derives the rest. That way a button cannot outlive the thing it answers, and
// the two faces cannot draw a different pair.
//
// Written into `meta.action` -- a key INSIDE meta, never meta itself. The
// Bird's delivery DM already stores `meta.paper`, so a call site that has meta
// of its own merges rather than replaces.
//
// Not on the @lifeweb/db barrel; require it by path, the db/lib/dm.js
// convention.

const DM_ACTION = Object.freeze({
  OFFER: "OFFER",
  THREAT_SPAWN: "THREAT_SPAWN",
  LOBBY_SEAT: "LOBBY_SEAT",
  KEYED_WAY: "KEYED_WAY",
  // The Release on an ambusher's own "you caught them" DM. The odd one out of
  // the family: every other kind is a PENDING ROW somebody is being asked
  // about, and this is the person who imposed a state ending it. It is a view
  // of a live hold (Character.heldUntil) rather than of an Offer, which is
  // also why it never became an Offer kind — an Offer's responder answers, and
  // here the initiator does (docs/systemdocs/INTERCEPT.md).
  INTERCEPT_HOLD: "INTERCEPT_HOLD",
  // Calling off a fight you started (docs/systemdocs/ATTACK.md). The same odd
  // shape as INTERCEPT_HOLD above — the initiator answers, not the responder —
  // and it replaced that button on an ambusher's DM, because an ambush is an
  // attack now and breaking one off has to unpick BOTH holds rather than one.
  ATTACK_HOLD: "ATTACK_HOLD",
  // A tax filed against you (docs/tags.yaml's `taxman` description,
  // db/lib/tax.js). A pending row, like OFFER — but only one answer exists,
  // the LOBBY_SEAT shape: there is no Accept, doing nothing IS the accept.
  PENDING_TAX: "PENDING_TAX",
  // The Bird's Reply (docs/systemdocs/BIRD.md). The one kind in this family
  // that draws NO generic button row: answering a letter means choosing which
  // of the papers in your hands goes back, which is a picker, not an Accept.
  // So it has no DM_ACTION_LABELS entry — dmActionLabels returns null and
  // DmActionRow renders nothing — and the web draws its own Reply on the
  // letter card instead (web/app/components/DmThread.js#LetterBody).
  //
  // It is still a descriptor rather than nothing at all, because everything
  // else in this file is still wanted: the row records that it ASKS
  // something, the liveness resolver stops a month-old letter looking
  // answerable, and DmThread stops collapsing it into "3 automated messages".
  BIRD_REPLY: "BIRD_REPLY",
});

// The two answers. Every family reads as one of these, even where Discord
// labels them differently -- escort says "Cancel" and the keyed way says
// "No", but both are a decline.
const DM_CHOICE = Object.freeze({ ACCEPT: "accept", DECLINE: "decline", PARTIAL: "partial" });

// What the web draws, matching the labels on the Discord row builders
// (db/lib/offerRow.js, db/lib/threatSpawn.js, db/lib/lobby.js,
// db/lib/locationAnchorRow.js). Kept beside the kinds so a relabelled button
// on one face is a one-line change on both.
//
// `decline: null` means the family has no decline button at all.
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

// The descriptor a sendDm call site spreads into `meta`. `variant` is optional
// and only says which label set to draw -- "ESCORT" today, nothing else.
//
//   sendDm(id, text, { components: offerButtonRow(offer.id),
//                      meta: dmAction(DM_ACTION.OFFER, offer.id) })
function dmAction(kind, id, variant = null) {
  if (!DM_ACTION[kind]) throw new Error(`Unknown DM action kind: ${kind}`);
  return { action: variant ? { kind, id: String(id), variant } : { kind, id: String(id) } };
}

// The labels for a descriptor, variant first. Returns null for anything this
// build does not know, so an old row written by a newer deploy draws no
// buttons rather than throwing in the renderer.
function dmActionLabels(action) {
  if (!action?.kind) return null;
  return DM_ACTION_LABELS[action.variant] ?? DM_ACTION_LABELS[action.kind] ?? null;
}

// Reads the descriptor off a DirectMessage row, or null. One reader, so the
// shape of `meta` is known in one place.
function dmActionOf(row) {
  const action = row?.meta?.action;
  if (!action?.kind || !action?.id) return null;
  if (!DM_ACTION[action.kind]) return null;
  return action;
}

module.exports = { DM_ACTION, DM_CHOICE, DM_ACTION_LABELS, dmAction, dmActionLabels, dmActionOf };
