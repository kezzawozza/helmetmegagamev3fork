// Human forms of staged rows, shared by the desk, the tray and the preview.
// Pure functions over DTOs — no server imports, safe in client components.

import { chunkMessage } from "@lifeweb/db/lib/chunkText";

// How many Discord messages a staged body will arrive as. chunkText.js is the
// dependency-free half of the REST layer, so importing it here keeps this
// module client-safe — never import from discordRest.js, which reads
// DISCORD_TOKEN and calls fetch.
export function chunkCount(content) {
  return chunkMessage((content ?? "").trim()).length;
}

// id -> the full catalog row, not just the name — effectSegments below needs
// the whole tag for a hoverable TagChip, the same row TagCatalogBrowser and
// EffectComposer.js's own tag chips already render from.
export function tagLookup(tagCatalog) {
  return new Map(tagCatalog.map((t) => [t.id, t]));
}

// A staged row created before Silos were removed can still carry a
// "faction" party — render it plainly, same as any other party.
function partyLabel(party) {
  if (!party) return "?";
  return party.name;
}

// "+3 ⬢ · +Explosion Burns · −Fine Meal ×2", as segments rather than a
// joined string — a `"tagchip"` segment carries the live tag row (when it's
// still in the catalog) so a renderer can show a real hoverable TagChip
// instead of a name with nothing behind it. `tagsById` is a Map(id -> full
// tag row), from tagLookup() above.
// What a staged row is aimed at, when it isn't a character. Both the desk and
// the preview draw this, so the wording lives in one place.
export function effectTargetLabel(effect) {
  if (effect.room) {
    return effect.room.locationName ? `${effect.room.locationName} — ${effect.room.name}` : effect.room.name;
  }
  return "Transfer";
}

export function effectSegments(effect, tagsById) {
  const segs = [];
  if (effect.transfer) {
    const { from, to, amount } = effect.transfer;
    segs.push({ k: "text", v: `${partyLabel(from)} → ${partyLabel(to)} · ${amount} ⬢` });
  }
  if (effect.resources) segs.push({ k: "text", v: `${effect.resources > 0 ? "+" : ""}${effect.resources} ⬢` });
  if (effect.tagPoints) {
    segs.push({ k: "text", v: `${effect.tagPoints > 0 ? "+" : "−"}${Math.abs(effect.tagPoints)} tp` });
  }
  for (const op of effect.tagOps ?? []) {
    const tag = tagsById.get(op.tagId) ?? null;
    const qty = op.quantity != null && op.quantity > 1 ? op.quantity : null;
    segs.push({ k: "tagchip", op: op.op, tag, name: tag?.name ?? "a tag", quantity: qty });
  }
  // A room row's ⬢ and tags. Separate keys from the character ones above, so
  // the two can never render as one muddled line, and the ⬢ says where it
  // landed — "+5 ⬢" on a row labelled with a room would otherwise read as a
  // payout to somebody.
  if (effect.roomResources) {
    segs.push({ k: "text", v: `${effect.roomResources > 0 ? "+" : ""}${effect.roomResources} ⬢ in the stash` });
  }
  for (const op of effect.roomTagOps ?? []) {
    const tag = tagsById.get(op.tagId) ?? null;
    const qty = op.quantity != null && op.quantity > 1 ? op.quantity : null;
    segs.push({ k: "tagchip", op: op.op, tag, name: tag?.name ?? "a tag", quantity: qty });
  }
  if (effect.locationId) segs.push({ k: "text", v: `→ ${effect.locationName ?? "?"}` });
  return segs;
}

// The plain-text form, for a confirm dialog's sentence — nowhere for a
// HoverCard to portal to inside one of those, so this just names the tag.
export function effectSummary(effect, tagsById) {
  const parts = effectSegments(effect, tagsById).map((seg) => {
    if (seg.k === "text") return seg.v;
    const qty = seg.quantity ? ` ×${seg.quantity}` : "";
    return `${seg.op === "add" ? "+" : "−"}${seg.name}${qty}`;
  });
  return parts.join(" · ") || "nothing";
}

// The one-word state of a staged row, for a status pill.
export function effectState(effect) {
  if (effect.appliedError) return { label: "Errored", tone: "bad" };
  if (effect.applied) return { label: "Applied", tone: "good" };
  // Missed push is the warning; Staged is the normal resting state of every
  // row on the desk and was wearing the warning colour, so the one row that
  // actually needed chasing did not stand out from the twenty that did not.
  if (effect.missed) return { label: "Missed push", tone: "warn" };
  return { label: "Staged", tone: "neutral" };
}

export function messageState(message) {
  const rows = Array.isArray(message.deliveries) ? message.deliveries : [];
  if (message.sent && rows.length) {
    // Counted off the Delivery rows, so the pill says HOW MANY bounced rather
    // than only that something did — and it says "Sending" while a retry is in
    // flight, which "Sent, some failed" could not.
    const failed = rows.filter((d) => d.state === "FAILED").length;
    if (rows.some((d) => d.state === "IN_FLIGHT")) return { label: "Sending…", tone: "warn" };
    if (failed) return { label: `Sent · ${failed} failed`, tone: "bad" };
    if (rows.every((d) => d.state === "SENT")) return { label: "Sent", tone: "good" };
  }
  if (message.sent && message.deliveryFailures) return { label: "Sent, some failed", tone: "bad" };
  if (message.sent) return { label: "Sent", tone: "good" };
  // Same vocabulary as effectState above: the miss is the warning, staged is
  // the resting state.
  if (message.missed) return { label: "Missed push", tone: "warn" };
  return { label: "Staged", tone: "neutral" };
}

// One short line per recipient who is not simply done — "Ada: DMs closed",
// "Bram: sending…". Empty when everything landed, so a clean message says
// nothing extra. The blob-era fallback keeps an old turn readable.
export function deliveryNotes(message) {
  const rows = Array.isArray(message.deliveries) ? message.deliveries : [];
  if (rows.length) {
    return rows
      .filter((d) => d.state !== "SENT")
      .map((d) => {
        const who = d.name ?? "the channel";
        if (d.state === "IN_FLIGHT") return `${who}: sending…`;
        if (d.state === "PENDING") return `${who}: not sent yet`;
        return `${who}: ${d.error ?? "failed"}${d.attempts > 1 ? ` (${d.attempts} tries)` : ""}`;
      });
  }
  const blob = Array.isArray(message.deliveryFailures) ? message.deliveryFailures : [];
  return blob.map((f) => `${f.name ?? "the channel"}: ${f.error ?? "failed"}`);
}

export function truncate(text, limit = 120) {
  const clean = (text ?? "").trim();
  return clean.length > limit ? `${clean.slice(0, limit - 1)}…` : clean;
}
