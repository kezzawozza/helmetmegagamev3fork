// A Room's stash — the ⬢ and tag stacks lying in it (docs/systemdocs/CARRY.md).
// Pure helpers plus the one lookup the overflow drop needs. Takes `prisma`
// (or a tx) as a parameter, same reason as db/lib/dm.js, and stays off the
// @lifeweb/db barrel; require it by path.
const { record, recordDelta, BURN } = require("./economyLedger");

// findMany + a JS pick rather than ORDER BY random(): Prisma would need raw
// SQL for that, and a Location has a handful of rooms at most. Every PUBLIC
// room is a valid destination, provisioned or not — an unprovisioned one
// simply gets no announcement.
// A room that eats what is put into it (Room.destroysContents — the Godard
// Factory's Spillway) is NEVER eligible. The overflow drop is not a choice
// anybody made: a refining shift makes 136 lb of Squeeze against an 84 lb cap,
// so the carry pass fires on the intended loop, every day, and a one-in-three
// roll would delete a day's work nobody threw away. Tipping something into the
// trough has to stay a thing you do on purpose (docs/systemdocs/FACTORY.md §9).
async function pickRandomPublicRoom(db, locationId) {
  if (!locationId) return null;
  const rooms = await db.room.findMany({
    where: { locationId, kind: "PUBLIC", destroysContents: false },
    select: { id: true, name: true, discordThreadId: true, locationId: true },
  });
  if (rooms.length === 0) return null;
  return rooms[Math.floor(Math.random() * rooms.length)];
}

// Mints or burns a room's own ⬢, clamped at 0 — the stash's answer to
// moveEffects.js#addResources, and a direct copy of its shape for the same
// reasons: one atomic statement rather than read-then-write (a GM's staged
// burn can race a player's Transfer into the same room), GREATEST for a clamp
// Prisma's `increment` can't express, and FOR UPDATE so nothing lands between
// the `before` this reports and the `after` it wrote. The caller records what
// MOVED, not what was asked for.
//
// This is deliberately NOT resourceTransfer.js#moveParty. That one is the
// conservation primitive — a leg of a transfer between two parties — and it
// throws when a burn overdraws, because a transfer that took less than it gave
// would mint ⬢ out of nothing. A GM adjustment has no other end to balance
// against, so the clamp is the right answer and the returned delta is the
// whole story.
//
// A room that eats what is put into it (Room.destroysContents — the Godard
// Factory's Spillway) takes no credit, the same asymmetry moveParty encodes:
// ⬢ going in goes nowhere, ⬢ coming out is still allowed. The arrival and its
// destruction are both booked, exactly as moveParty books them, so the
// reconciliation check on /gm/economy still nets to the room's real balance.
//
// This is a money chokepoint, so it writes to the economy ledger
// (db/lib/economyLedger.js): `ctx` carries the reason — GM_GRANT or GM_TAKE
// from the adjudication desk — and a write with no reason is recorded
// UNATTRIBUTED rather than dropped, which is what keeps an un-hooked caller
// visible on the panel instead of quietly missing.
async function addRoomResources(tx, roomId, amount, ctx = {}) {
  if (!amount) return 0;
  const room = await tx.room.findUnique({
    where: { id: roomId },
    select: { id: true, name: true, destroysContents: true, location: { select: { zoneId: true } } },
  });
  if (!room) return 0;
  const party = { kind: "room", id: room.id, name: room.name, zoneId: room.location?.zoneId ?? null };

  if (amount > 0 && room.destroysContents) {
    // Two rows netting to zero, the same shape moveParty uses: the ⬢ arrived
    // and was destroyed, and the room's balance never moved. One row would
    // break the panel's reconciliation check.
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
  // The shortfall a GREATEST(0, ...) floor destroyed, booked under CLAMP — the
  // reason the ledger added for exactly this silent burn. Without it an
  // over-large GM burn leaves no trace that more was asked for than existed.
  const clamped = amount - moved;
  if (clamped < 0) {
    await record(tx, { from: party, to: BURN, form: "BALANCE", amount: -clamped }, { ...ctx, reason: "CLAMP" });
  }
  return moved;
}

// "Graga Sac ×3" / "Lantern".
function formatStack(name, quantity) {
  return (quantity ?? 1) > 1 ? `${name} ×${quantity}` : name;
}

// "a, b and c" — no Oxford comma, matching the whisper poll's joiner.
function joinList(items) {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`;
}

// The goods in a transfer or a drop as one phrase: "Graga Sac ×3, Lantern
// and 12 ⬢". `tags` is [{ tagName | name, quantity }].
function formatManifest(tags = [], resources = 0) {
  const parts = tags.map((t) => formatStack(t.tagName ?? t.name, t.quantity));
  if (resources > 0) parts.push(`${resources} ⬢`);
  return joinList(parts);
}

// The Storage button's reply, in Bascinet's own format. `room` carries
// `resources` and `tags: [{ quantity, tag: { name } }]`.
function formatStashLine(room) {
  const tags = (room.tags ?? []).filter((rt) => rt.quantity > 0);
  if (tags.length === 0 && !(room.resources > 0)) return "-# Nothing is stored here.";
  const names = tags.map((rt) => formatStack(rt.tag.name, rt.quantity)).join(", ");
  return `-# ${room.resources ?? 0} ⬢ | **Tags**: ${names || "none"}`;
}

module.exports = { pickRandomPublicRoom, addRoomResources, formatStack, joinList, formatManifest, formatStashLine };
