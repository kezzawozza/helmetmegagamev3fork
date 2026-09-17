// The train comes in, and everything anybody paid for is on it.
//
// One crate stack per undelivered DepotOrder, set down in the Railyard. The
// packing is db/lib/depotCrates.js unchanged — including the rule that one
// sealed line item seals the whole crate it lands in, so nobody knows which box
// holds the bad news. What is new is the stamp: a crate says whose order it is,
// by fingerprint name, unless the buyer paid to stay off it.
//
// Runs every OTHER turn (db/lib/train.js). Parity decides whether the pass runs
// at all; what it delivers is decided entirely by `deliveredAt: null`, so a
// resumed or doubled advance costs a turn of flavour and never a shipment.
//
// Like every other pass it mutates the database and RETURNS its side effects
// rather than making a network call itself (TURN-ENGINE.md §3).

const { splitIntoCrates, crateTagData, shipmentId } = require("./depotCrates");
const { addToRoomStack } = require("./tagWrites");
const { isArrivalTurn, RAILYARD_ROOM_SLUG } = require("./train");
const { record, roomParty, COMPANY, turnStamp } = require("./economyLedger");

const TRAIN_ARRIVED_LINE = {
  text: "You hear the train grind in and stop. Somebody starts unloading.",
  signed: false,
};

// The manifest printed on the side of a crate, with the buyer's stamp in front
// of it. A sealed crate still says whose it is — the seal hides WHAT is in it,
// which is a different secret from whose it is.
function stampFor(order) {
  return order.anonymous ? "ANONYMOUS" : `${order.holderName} · ${order.fingerprint}`;
}

async function runTrainArrivalPass(prisma, turn) {
  if (!isArrivalTurn(turn?.number)) return { ran: false, delivered: 0, crates: 0 };

  const room = await prisma.room.findUnique({
    where: { slug: RAILYARD_ROOM_SLUG },
    select: { id: true, name: true, location: { select: { id: true, zoneId: true } } },
  });
  // No Railyard means the zone import has not been run. Say nothing and change
  // nothing — the orders stay queued and land on the next arrival.
  if (!room) return { ran: false, delivered: 0, crates: 0, missingRoom: true };

  const orders = await prisma.depotOrder.findMany({
    where: { deliveredAt: null },
    orderBy: { createdAt: "asc" },
  });
  if (!orders.length) return { ran: true, delivered: 0, crates: 0, locationId: room.location?.id ?? null };

  // Crates need a group to render like any other item; "items-gear" is the
  // catalog's catch-all for carried objects.
  const group = await prisma.tagGroup.findUnique({ where: { slug: "items-gear" }, select: { id: true } });

  const tagIds = [
    ...new Set(orders.flatMap((o) => (Array.isArray(o.lines) ? o.lines : []).map((l) => l.tagId)).filter(Boolean)),
  ];
  const weights = await prisma.tag.findMany({ where: { id: { in: tagIds } }, select: { id: true, weightLbs: true } });
  const weightByTagId = new Map(weights.map((t) => [t.id, t.weightLbs ?? 0]));

  let delivered = 0;
  let crateCount = 0;

  for (const order of orders) {
    const lines = Array.isArray(order.lines) ? order.lines : [];
    const shipment = shipmentId();
    const crates = splitIntoCrates(lines, { weightByTagId });

    try {
      await prisma.$transaction(async (tx) => {
        // The claim IS the check: a resumed advance finds nothing to take.
        const { count } = await tx.depotOrder.updateMany({
          where: { id: order.id, deliveredAt: null },
          data: { deliveredAt: new Date(), deliveredTurn: turn.number },
        });
        if (!count) return;

        const stamp = stampFor(order);
        let resourcesLanded = 0;

        for (const data of crateTagData(shipment, crates, { groupId: group?.id ?? null, weightByTagId })) {
          const { crateContents, description, ...tagFields } = data;
          const tag = await tx.tag.create({
            data: {
              ...tagFields,
              // `[SHIPMENT ID RV-4471-K] · ADA VOSS: Coal x 4 | Bandage x 6`.
              // The stamp goes between the id and the contents so a sealed
              // crate — which prints no contents — still reads whose it is.
              description: description.replace("]:", `] · ${stamp}:`),
              crateContents,
            },
          });
          await addToRoomStack(tx, room.id, tag.id, 1);
          resourcesLanded += tagFields.consumesIntoResources ?? 0;
          crateCount += 1;
        }

        // A crate is an unpriced runtime tag, so the tag hook books nothing for
        // it — but ⬢ riding inside one are real money arriving in the world.
        if (resourcesLanded > 0) {
          await record(
            tx,
            { from: COMPANY, to: roomParty({ ...room, zoneId: room.location?.zoneId ?? null }), form: "BALANCE", amount: resourcesLanded },
            { reason: "TRAIN_DELIVERY", roomId: room.id, locationId: room.location?.id ?? null, ...turnStamp(turn) },
          );
        }

        delivered += 1;
      });
    } catch (err) {
      // One bad order must not strand the rest of the train. It stays queued,
      // since the claim rolled back with everything else.
      console.error(`Train delivery failed for order ${order.id}:`, err?.message ?? err);
    }
  }

  return {
    ran: true,
    delivered,
    crates: crateCount,
    roomId: room.id,
    locationId: room.location?.id ?? null,
    lines: delivered > 0 ? [TRAIN_ARRIVED_LINE] : [],
  };
}

module.exports = { runTrainArrivalPass, TRAIN_ARRIVED_LINE, stampFor };
