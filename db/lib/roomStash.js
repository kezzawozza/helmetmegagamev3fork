// A Room's stash — the ⬢ and tag stacks lying in it (docs/systemdocs/CARRY.md). Takes `prisma` (or a tx), stays off the @lifeweb/db barrel.
const { record, recordDelta, BURN } = require("./economyLedger");
const { addRoomResources: bumpRoomStack, resourcesOf, RESOURCES_SLUG, withoutResources } = require("./resourceStack");

// findMany + a JS pick rather than ORDER BY random(): a Location has a handful of rooms at most. A room that eats what is put into it
// (Room.destroysContents — the Godard Factory's Spillway) is NEVER eligible — tipping into the trough must stay on purpose (docs/systemdocs/FACTORY.md §9).
async function pickRandomPublicRoom(db, locationId) {
  if (!locationId) return null;
  const rooms = await db.room.findMany({
    where: { locationId, kind: "PUBLIC", destroysContents: false },
    select: { id: true, name: true, discordThreadId: true, locationId: true },
  });
  if (rooms.length === 0) return null;
  return rooms[Math.floor(Math.random() * rooms.length)];
}

// Mints or burns a room's own ⬢, clamped at 0 — the same shape as moveEffects.js#addResources, over db/lib/resourceStack.js's stack write.
// Deliberately NOT resourceTransfer.js#moveParty (throws on overdraw) — a GM adjustment has no other end to balance against, so clamping is right.
// A destroysContents room takes no credit for ⬢ going in; arrival and destruction are both booked so reconciliation nets correctly.
// Writes to the economy ledger: `ctx` carries the reason, and a write with none is UNATTRIBUTED rather than dropped.
async function addRoomResources(tx, roomId, amount, ctx = {}) {
  if (!amount) return 0;
  const room = await tx.room.findUnique({
    where: { id: roomId },
    select: { id: true, name: true, destroysContents: true, location: { select: { zoneId: true } } },
  });
  if (!room) return 0;
  const party = { kind: "room", id: room.id, name: room.name, zoneId: room.location?.zoneId ?? null };

  if (amount > 0 && room.destroysContents) {
    // Two rows netting to zero: the ⬢ arrived and was destroyed. One row would break the panel's reconciliation check.
    await recordDelta(tx, party, amount, ctx);
    await record(tx, { from: party, to: BURN, form: "BALANCE", amount }, { ...ctx, reason: "SPILLWAY" });
    return 0;
  }

  const { moved, clamped } = await bumpRoomStack(tx, roomId, amount);
  if (moved) await recordDelta(tx, party, moved, ctx);
  // The shortfall the floor destroyed, booked under CLAMP — without it an over-large GM burn leaves no trace.
  if (clamped > 0) {
    await record(tx, { from: party, to: BURN, form: "BALANCE", amount: clamped }, { ...ctx, reason: "CLAMP" });
  }
  return moved;
}

function formatStack(name, quantity) {
  return (quantity ?? 1) > 1 ? `${name} ×${quantity}` : name;
}

// "a, b and c" — no Oxford comma, matching the whisper poll's joiner.
function joinList(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// A ⬢ stack prints as "12 ⬢", not "Resources ×12" — the glyph replaces the word wherever a quantity is shown (CLAUDE.md). Callers that know a stack's slug pass it; the `resources` argument is the older shape, for the a few callers still holding a loose count.
function formatManifest(tags = [], resources = 0) {
  const parts = tags.map((t) =>
    (t.tagSlug ?? t.slug) === RESOURCES_SLUG
      ? `${t.quantity ?? 1} ⬢`
      : formatStack(t.tagName ?? t.name, t.quantity),
  );
  if (resources > 0) parts.push(`${resources} ⬢`);
  return joinList(parts);
}

// ⬢ are one of the stacks now, so they are pulled out of `tags` rather than read off a column beside it.
function formatStashLine(room) {
  const tags = (room.tags ?? []).filter((rt) => rt.quantity > 0);
  const resources = resourcesOf(room);
  const goods = withoutResources(tags);
  if (goods.length === 0 && !(resources > 0)) return "-# Nothing is stored here.";
  const names = goods.map((rt) => formatStack(rt.tag.name, rt.quantity)).join(", ");
  return `-# ${resources} ⬢ | **Tags**: ${names || "none"}`;
}

module.exports = { pickRandomPublicRoom, addRoomResources, formatStack, joinList, formatManifest, formatStashLine };
