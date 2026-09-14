// A Room's stash — the ⬢ and tag stacks lying in it (docs/systemdocs/CARRY.md). Takes `prisma` (or a tx), stays off the @lifeweb/db barrel.
const { record, recordDelta, BURN } = require("./economyLedger");

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

// Mints or burns a room's own ⬢, clamped at 0 — a direct copy of moveEffects.js#addResources's shape (atomic, GREATEST for the clamp, FOR UPDATE).
// Deliberately NOT resourceTransfer.js#moveParty (throws on overdraw) — a GM adjustment has no other end to balance against, so clamping is right.
// A destroysContents room takes no credit for ⬢ going in; arrival and destruction are both booked so /gm/economy's reconciliation nets correctly.
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

  const rows = await tx.$queryRaw`
    WITH prev AS (
      SELECT "resources" AS before FROM "Room" WHERE "id" = ${roomId} FOR UPDATE
    )
    UPDATE "Room" r
    SET "resources" = GREATEST(0, prev.before + ${amount})
    FROM prev
    WHERE r."id" = ${roomId}
    RETURNING prev.before AS before, r."resources" AS after
  `;
  const before = rows[0]?.before ?? 0;
  const after = rows[0]?.after ?? before;
  const moved = after - before;
  if (moved) await recordDelta(tx, party, moved, ctx);
  // The shortfall the GREATEST(0, ...) floor destroyed, booked under CLAMP — without it an over-large GM burn leaves no trace.
  const clamped = amount - moved;
  if (clamped < 0) {
    await record(tx, { from: party, to: BURN, form: "BALANCE", amount: -clamped }, { ...ctx, reason: "CLAMP" });
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

function formatManifest(tags = [], resources = 0) {
  const parts = tags.map((t) => formatStack(t.tagName ?? t.name, t.quantity));
  if (resources > 0) parts.push(`${resources} ⬢`);
  return joinList(parts);
}

function formatStashLine(room) {
  const tags = (room.tags ?? []).filter((rt) => rt.quantity > 0);
  if (tags.length === 0 && !(room.resources > 0)) return "-# Nothing is stored here.";
  const names = tags.map((rt) => formatStack(rt.tag.name, rt.quantity)).join(", ");
  return `-# ${room.resources ?? 0} ⬢ | **Tags**: ${names || "none"}`;
}

module.exports = { pickRandomPublicRoom, addRoomResources, formatStack, joinList, formatManifest, formatStashLine };
