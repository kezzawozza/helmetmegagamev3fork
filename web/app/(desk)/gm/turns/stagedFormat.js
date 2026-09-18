// Human forms of staged rows, shared by the desk, the tray and the preview.
// Pure functions over DTOs — no server imports, safe in client components.

import { chunkMessage } from "@lifeweb/db/lib/chunkText";

// How many Discord messages a staged body will arrive as. Uses chunkText.js,
// not discordRest.js (reads DISCORD_TOKEN, calls fetch), to keep this module client-safe.
export function chunkCount(content) {
  return chunkMessage((content ?? "").trim()).length;
}

// id -> full catalog row, not just the name — effectSegments needs the whole tag for a hoverable TagChip.
export function tagLookup(tagCatalog) {
  return new Map(tagCatalog.map((t) => [t.id, t]));
}

// A staged row created before Silos were removed can still carry a
// party kind that is no longer minted — render it plainly, same as any other party.
function partyLabel(party) {
  if (!party) return "?";
  return party.name;
}

// "+3 ⬢ · +Explosion Burns · −Fine Meal ×2", as segments rather than a
// joined string — a `"tagchip"` segment carries the live tag row so a
// renderer can show a real hoverable TagChip. `tagsById` from tagLookup() above.
// What a staged row is aimed at when it isn't a character; shared wording for the desk and the preview.
export function effectTargetLabel(effect) {
  if (effect.room) {
    return effect.room.locationName ? `${effect.room.locationName} — ${effect.room.name}` : effect.room.name;
  }
  return "Transfer";
}

export function effectSegments(effect, tagsById) {
  const segs = [];
  // A death payload carries nothing else — db/lib/stagedPush.js short-circuits on it before any other key.
  if (effect.death) {
    segs.push({
      k: "text",
      v: effect.death.gib ? `Gibbed — ${effect.death.reason}` : `Killed — ${effect.death.reason}`,
    });
    return segs;
  }
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
  // A room row's ⬢ and tags — separate keys so it can never muddle with the character line above.
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

// The plain-text form, for a confirm dialog's sentence — no HoverCard portal inside one, so this just names the tag.
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
  if (effect.applied) {
    // The target died some other way before the push reached this row (applyDeathToRow's claim came back false) — not a failure.
    if (effect.death && effect.appliedDeath && effect.appliedDeath.claimed === false) {
      return { label: "No-op — already dead", tone: "warn" };
    }
    return { label: "Applied", tone: "good" };
  }
  // Missed push is the warning; Staged is the normal resting state.
  if (effect.missed) return { label: "Missed push", tone: "warn" };
  return { label: "Staged", tone: "neutral" };
}

export function messageState(message) {
  const rows = Array.isArray(message.deliveries) ? message.deliveries : [];
  if (message.sent && rows.length) {
    // Counted off Delivery rows, so the pill says HOW MANY bounced, and can say "Sending" while a retry is in flight.
    const failed = rows.filter((d) => d.state === "FAILED").length;
    if (rows.some((d) => d.state === "IN_FLIGHT")) return { label: "Sending…", tone: "warn" };
    if (failed) return { label: `Sent · ${failed} failed`, tone: "bad" };
    if (rows.every((d) => d.state === "SENT")) return { label: "Sent", tone: "good" };
  }
  if (message.sent && message.deliveryFailures) return { label: "Sent, some failed", tone: "bad" };
  if (message.sent) return { label: "Sent", tone: "good" };
  if (message.missed) return { label: "Missed push", tone: "warn" }; // same vocabulary as effectState above
  return { label: "Staged", tone: "neutral" };
}

// One short line per recipient who is not simply done — "Ada: DMs closed",
// "Bram: sending…". Empty when everything landed. Blob-era fallback keeps an old turn readable.
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
