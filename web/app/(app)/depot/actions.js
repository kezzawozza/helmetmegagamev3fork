"use server";

import { revalidatePath } from "next/cache";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { redirect } from "next/navigation";
import {
  prisma,
  MERCHANT_LICENSE_SLUG,
  DEPOT_LOCATION_SLUG,
  DEPOT_KEYCARD_SLUG,
  COAL_SLUG,
  SALTPETER_SLUG,
  OBOL_SLUG,
  LANDING_PAD_SLUG,
  normalizeQuantity,
  RESOURCE_IMPORT_PRICE,
  RESOURCE_EXPORT_PRICE,
  RESOURCE_WARE_ID,
  loadDepot,
  bumpAccount,
  bumpFuel,
  depotPowered,
  creditAvailableObols,
  shipmentId,
  splitIntoCrates,
  crateTagData,
} from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { isSuperadmin } from "@/lib/superadmin";
import { getOpenTurn } from "@/lib/turn";
import { TURNS_PATH } from "@/lib/routes";
import { logAudit } from "@/lib/requests";
import { addToStack, dropCharacterTag, addToRoomStack, dropRoomTag } from "@/lib/tagEffects";
import { blockerFor, ACT } from "@lifeweb/db/lib/incapacitation";
import { UserError, guarded } from "@/lib/actionResult";
import { postMessage } from "@lifeweb/db/lib/discordRest";
import { ambientLine } from "@lifeweb/db/lib/ambientLine";
import { SHUTTLE_LANDED_LINE, SHUTTLE_DEPARTED_LINE } from "@lifeweb/db/lib/depotPass";
import { refreshLiveRooms } from "@lifeweb/db/lib/syncZones";

// The Merchant's station. Same contract as every other player Request
// (docs/systemdocs/REQUESTS.md): authenticate, re-validate everything the
// client sent, then apply the effect and write the Request + AuditLog rows in
// ONE transaction, auto-passed for a GM to review after.
//
// Two things are different here from the rest of the app.
//
// The money is obols, and it lives on the Depot row rather than on anybody's
// character. The licence is tradeable, so handing it over hands over the
// account — which is the point, and the reason nothing below reads
// `character.resources` for a price.
//
// And the counterparty is not in the game. The orbital station has no balance
// to debit and no stock to run down, so each of these moves exactly one side.
// That is also why every snapshot below carries the unit price: a GM
// re-tuning docs/tags.yaml next week must not change what an Undo of today's
// order reverses.

// One line item's worth of sanity on an order, so a fat-fingered manifest
// cannot file for ten thousand vials.
const MAX_ORDER_LINES = 40;

// A page gate is advisory; a server action is a public endpoint. Everything
// below re-checks the papers AND that you are standing at the Depot. The
// Depot is a hangar in the caves — you cannot run it by remote.
//
// There are two doors into these actions, and the split is deliberate.
//
// `requireLicensedMerchant` is the money and the gun: ordering, the ATM, the
// credit line, the turret. Those want the Merchant's Licence —
// the LICENCE and not the merchant ROLE, because the licence is tradeable and
// a role check would quietly break that.
//
// `requireDepotHand` is the labour: calling the shuttle down, sending it back
// up, feeding the generator and firing it up. A Depot Keycard is enough for
// those, so a Docker can keep the station moving while the Merchant is
// asleep — which, on 24-hour turns, is most of the day. None of them spends
// an obol or points the gun at anybody.
async function requireDepotStanding({ needsPower = true } = {}) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    include: { tags: { include: { tag: true } }, location: { select: { slug: true, id: true } } },
  });
  if (!character) throw new UserError("You need a living character to do that.");
  if (character.location?.slug !== DEPOT_LOCATION_SLUG) {
    throw new UserError("The Depot is its own room in the caves. You have to be standing in it.");
  }

  // Working a console is an ACT. This check used to sit only on the
  // crate-opening guard below, which meant an incapacitated Merchant could
  // still order, bank and refuel from the floor.
  const blocker = blockerFor(character.tags, ACT);
  if (blocker) throw new UserError(`You can't do that right now. You're ${blocker.name}.`);

  const depot = await loadDepot(prisma);

  // The generator gates almost everything, and it has to be checked here
  // rather than trusted from the disabled button the client rendered. The
  // power switch and the fuel hatch are the two that must work in the dark.
  if (needsPower && !depotPowered(depot)) {
    throw new UserError("The generator is out. Nothing here runs without it.");
  }

  const held = heldSlugSet(character);
  return {
    session,
    character,
    depot,
    licensed: held.has(MERCHANT_LICENSE_SLUG),
    keycard: held.has(DEPOT_KEYCARD_SLUG),
  };
}

async function requireLicensedMerchant(opts) {
  const gate = await requireDepotStanding(opts);
  if (!gate.licensed) {
    throw new UserError("That one wants the Merchant's Licence.");
  }
  return gate;
}

// The working half of the console. A licence opens it too, obviously — the
// Merchant is not locked out of his own winch by holding the better card.
async function requireDepotHand(opts) {
  const gate = await requireDepotStanding(opts);
  if (!gate.licensed && !gate.keycard) {
    throw new UserError("The Depot answers to a Licence or a Keycard, and you have neither.");
  }
  return gate;
}

// The living-character-who-can-act gate every guard above is built on.
async function requireCharacter() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    include: { tags: { include: { tag: true } } },
  });
  if (!character) throw new UserError("You need a living character to do that.");
  // Every consumer of this guard is an ACT — ordering, working the shuttle,
  // the ATM, refuelling the generator. None of it is paperwork you do from a
  // chair, so the gate sits here rather than on ten call sites.
  const blocker = blockerFor(character.tags, ACT);
  if (blocker) throw new UserError(`You can't do that right now. You're ${blocker.name}.`);
  return { session, character };
}

function heldSlugSet(character) {
  return new Set(character.tags.map((ct) => ct.tag.slug));
}

function revalidateAll() {
  revalidatePath("/depot");
  revalidatePath("/character");
  revalidatePath("/gm/players", "layout");
  revalidatePath(TURNS_PATH, "page");
  revalidatePath("/gm/audit");
}

// The landing pad, loaded with its stash. Every shuttle action works through
// this one room, so a missing row is a sync problem worth naming out loud
// rather than a silent no-op.
// A line the room witnesses, spoken into the Depot's Location channel.
//
// Best-effort and never inside the transaction: a Discord outage must not roll
// back a shuttle that really did land.
async function speakAtDepot(line) {
  const location = await prisma.location
    .findUnique({ where: { slug: DEPOT_LOCATION_SLUG }, select: { discordChannelId: true } })
    .catch(() => null);
  if (!location?.discordChannelId) return;
  await postMessage(
    location.discordChannelId,
    ambientLine(line.text, [], { signed: line.signed }),
  ).catch((err) => console.error("Depot ambient line failed:", err));
}

async function landingPad(tx = prisma) {
  const room = await tx.room.findUnique({
    where: { slug: LANDING_PAD_SLUG },
    include: { tags: { include: { tag: true } } },
  });
  if (!room) {
    throw new UserError("The landing pad isn't in the database yet. A GM needs to run the zone sync.");
  }
  return room;
}

// ─────────────────────────────────────────────────────────────────────────
// Ordering
// ─────────────────────────────────────────────────────────────────────────

// A whole cart in one Request, the way BUY_TAGS files a point-buy cart. Prices
// are read from the catalog in here; the client's are decoration.
//
// The obols leave the account NOW and the goods do not exist yet — that gap is
// the whole risk of the business, and it is why the shuttle clock matters.
async function depotOrderImpl({ items: rawItems }) {
  const { session, character, depot } = await requireLicensedMerchant();

  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new UserError("Nothing on the manifest.");
  }
  if (rawItems.length > MAX_ORDER_LINES) {
    throw new UserError(`That's more than ${MAX_ORDER_LINES} line items. Split the order.`);
  }

  // Collapse duplicate lines before pricing, so the same ware sent twice is
  // one line rather than two rows that each pass the quantity clamp.
  const wanted = new Map();
  for (const item of rawItems) {
    const quantity = normalizeQuantity(item?.quantity);
    if (quantity == null) throw new UserError("That isn't a quantity the Depot will handle.");
    wanted.set(item?.tagId ?? "", (wanted.get(item?.tagId ?? "") ?? 0) + quantity);
  }

  // ⬢ are a ware now, but they are not a Tag, so the sentinel row comes out
  // before anything touches the catalog. Priced here like every other line —
  // the client's number is decoration.
  const resourceUnits = wanted.get(RESOURCE_WARE_ID) ?? 0;
  wanted.delete(RESOURCE_WARE_ID);

  const tags = await prisma.tag.findMany({
    where: { id: { in: [...wanted.keys()] }, depotPrice: { not: null } },
  });
  if (tags.length !== wanted.size) throw new UserError("The Depot doesn't stock one of those.");

  let totalResources = 0;
  const lines = [];

  if (resourceUnits > 0) {
    if (normalizeQuantity(resourceUnits) == null) {
      throw new UserError("That's more ⬢ than the station will put on one shuttle.");
    }
    totalResources += RESOURCE_IMPORT_PRICE * resourceUnits;
    // No tagId, which is what marks it as Resources everywhere downstream —
    // db/lib/depotCrates.js packs it, and the crate grants it on opening.
    lines.push({
      name: "Resources",
      quantity: resourceUnits,
      unitPrice: RESOURCE_IMPORT_PRICE,
      sealed: false,
    });
  }
  for (const tag of tags) {
    const quantity = wanted.get(tag.id);
    // The whole quantity is re-clamped after the merge above, not just each
    // submitted line — otherwise two lines of 99 would slip 198 through.
    if (normalizeQuantity(quantity) == null) {
      throw new UserError(`That's more ${tag.name} than the station will put on one shuttle.`);
    }
    // A non-stackable ware can only ever be held once (CharacterTag is unique
    // on character+tag), so ordering two would charge for two and deliver one
    // when the crate is opened. Refused here rather than silently clamped —
    // 182 ⬢ quietly vanishing is worse than being told no.
    if (!tag.stackable && quantity > 1) {
      throw new UserError(`The station will not ship more than one ${tag.name}.`);
    }
    const unitPrice = tag.depotPrice;
    totalResources += unitPrice * quantity;
    lines.push({
      tagId: tag.id,
      name: tag.name,
      quantity,
      unitPrice,
      sealed: Boolean(tag.sealedShipping),
    });
  }

  // The catalog prices in ⬢ and an obol is one ⬢, so the cart total IS the
  // price. Nothing converts and nothing rounds. See db/lib/depotState.js.
  const total = totalResources;
  if ((depot.accountObols ?? 0) < total) {
    throw new UserError(`That order is ${total} ¢ and the account holds ${depot.accountObols ?? 0}.`);
  }

  const openTurn = await getOpenTurn();
  const existing = Array.isArray(depot.manifest) ? depot.manifest : [];

  await prisma.$transaction(async (tx) => {
    // The conditional clamp inside bumpAccount is what actually enforces the
    // balance — two tabs ordering the last of the money cannot both succeed.
    const moved = await bumpAccount(tx, -total);
    if (-moved.delta < total) {
      throw new UserError("The account moved while you were ordering. Try again.");
    }

    await tx.depot.update({
      where: { id: 1 },
      data: { manifest: [...existing, ...lines] },
    });

    const effect = { lines, total, totalResources, manifestBefore: existing, manifestAfter: [...existing, ...lines] };
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_depot_order",
      targetCharacterId: character.id,
      turnId: openTurn?.id ?? null,
      details: effect,
    });
  });

  revalidateAll();
  return { lines: lines.length, total };
}

// ─────────────────────────────────────────────────────────────────────────
// The shuttle
// ─────────────────────────────────────────────────────────────────────────

// The Landing Pad's starter message says whether the shuttle is on it
// (db/lib/roomLive.js), so every move of that state has to repaint it. Best
// effort: a Discord hiccup must not fail a shipment that already committed,
// and the next sync or refresh puts the line right.
async function refreshShuttleRoom() {
  await refreshLiveRooms(prisma, "shuttle").catch((err) =>
    console.error("landing pad refresh failed:", err.message),
  );
}

// Calling it down. Everything on the manifest becomes crates on the landing
// pad; an empty manifest still brings the shuttle, because he also needs it
// down to load goods going the other way.
async function depotCallShuttleImpl() {
  // A Docker's job. Calling it down cannot spend anything — the obols left
  // the account when the manifest was written — so the worst a keycard can do
  // here is bring the shuttle down early, and the pad is where the goods were
  // going anyway.
  const { session, character, depot } = await requireDepotHand();

  if (depot.shuttleState !== "AWAY") {
    throw new UserError("The shuttle is already down.");
  }

  const room = await landingPad();
  const manifest = Array.isArray(depot.manifest) ? depot.manifest : [];
  const openTurn = await getOpenTurn();

  const shipment = shipmentId();

  // Crates need a group so they render like any other item in the UI. The
  // gear group is the catch-all the catalog already uses for carried objects.
  const group = await prisma.tagGroup.findUnique({ where: { slug: "items-gear" } });

  // The wares' own weights, and they have to be in hand BEFORE the split: a
  // crate is packed by weight now, not by counting things into it, and it then
  // weighs half of what went in. A resources line has no tagId and is priced
  // at RESOURCE_UNIT_LBS inside the packer.
  const innerWeights = await prisma.tag.findMany({
    where: { id: { in: [...new Set(manifest.map((m) => m.tagId).filter(Boolean))] } },
    select: { id: true, weightLbs: true },
  });
  const weightByTagId = new Map(innerWeights.map((t) => [t.id, t.weightLbs ?? 0]));

  const crates = splitIntoCrates(manifest, { weightByTagId });

  await prisma.$transaction(async (tx) => {
    for (const data of crateTagData(shipment, crates, { groupId: group?.id ?? null, weightByTagId })) {
      const { crateContents, ...tagFields } = data;
      // ephemeral: game state, not catalog. A Restart Game sweeps every crate
      // still sitting on the landing pad (TAGS.md §5d).
      const tag = await tx.tag.create({ data: { ...tagFields, crateContents, ephemeral: true } });
      await addToRoomStack(tx, room.id, tag.id, 1);
    }

    await tx.depot.update({
      where: { id: 1 },
      data: {
        shuttleState: "DOCKED",
        // NEVER null. A null clock made both timers read "landed this turn"
        // forever: send-up stayed inside its cooldown, the auto-departure
        // never fired, and re-calling was refused because the state was not
        // AWAY — a permanently docked shuttle only SQL could free.
        // getOpenTurn() is legitimately null between advances, so 0 is the
        // floor: an already-elapsed turn number, which frees it immediately.
        shuttleTurn: openTurn?.number ?? 0,
        manifest: [],
      },
    });

    const effect = { shipment, crates: crates.length, manifest, roomId: room.id };
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_depot_shuttle_call",
      targetCharacterId: character.id,
      turnId: openTurn?.id ?? null,
      details: effect,
    });
  });

  await speakAtDepot(SHUTTLE_LANDED_LINE);
  await refreshShuttleRoom();
  revalidateAll();
  return { shipment, crates: crates.length };
}

// Sending it back, loaded. Everything sitting on the landing pad goes up and
// comes back as obols: tags at their sellablePrice, and the room's ⬢ stash at
// RESOURCE_EXPORT_PRICE. This is the ONLY way Resources become obols, which
// is what stops the Merchant printing money at a keyboard — and the station
// pays half what it charges for the same ⬢ coming down, so the round trip is
// a loss in both directions.
async function depotSendShuttleImpl() {
  // Also a Docker's job, and the sharper of the two: a keycard can sell
  // everything on the pad. That is the trade — a card that can load the
  // shuttle is a card that can load the wrong things onto it. The payout goes
  // to the station's account either way, so this moves goods, never money out
  // of the Depot, and the ledger names whoever pressed it.
  const { session, character, depot } = await requireDepotHand();

  if (depot.shuttleState !== "DOCKED") throw new UserError("The shuttle isn't here.");

  const openTurn = await getOpenTurn();
  const landed = depot.shuttleTurn ?? 0;
  const cooldown = depot.shuttleCooldown ?? 0;
  if (openTurn && openTurn.number - landed < cooldown) {
    throw new UserError("It only just landed. Give the crew a turn to work.");
  }

  const room = await landingPad();

  // A crate going back up is worth what is inside it, not nothing — otherwise
  // an unopened shipment would be destroyed by returning it, which reads as a
  // bug however you explain it.
  let goodsResources = 0;
  const soldTags = [];

  // A crate has no sellablePrice of its own — it is a box. Sending one back up
  // unopened has to pay for what is INSIDE it, or returning an unopened
  // shipment would silently annihilate it. Contents are priced off the live
  // catalog here rather than off the crate, since the crate only stores names
  // and counts.
  const crateInner = room.tags.filter((rt) => Array.isArray(rt.tag.crateContents));
  const innerIds = [...new Set(crateInner.flatMap((rt) => rt.tag.crateContents.map((c) => c.tagId)))];
  const innerPrice = new Map(
    innerIds.length
      ? (
          await prisma.tag.findMany({
            where: { id: { in: innerIds } },
            select: { id: true, sellablePrice: true },
          })
        ).map((t) => [t.id, t.sellablePrice ?? 0])
      : [],
  );

  for (const rt of room.tags) {
    const contents = Array.isArray(rt.tag.crateContents) ? rt.tag.crateContents : null;
    const unit = contents
      ? contents.reduce((sum, c) => sum + (innerPrice.get(c.tagId) ?? 0) * c.quantity, 0) +
        // ⬢ packed into the crate are worth what loose ⬢ are worth. Without
        // this line, sending an unopened shipment back up would annihilate
        // them — the same failure the crate-contents pricing above exists to
        // prevent, just for the half that is not a tag.
        (rt.tag.consumesIntoResources ?? 0) * RESOURCE_EXPORT_PRICE
      : (rt.tag.sellablePrice ?? 0);
    if (unit > 0) goodsResources += unit * rt.quantity;
    soldTags.push({
      tagId: rt.tagId,
      name: rt.tag.name,
      quantity: rt.quantity,
      unitPrice: unit,
      crate: Boolean(contents),
    });
  }
  // Loose ⬢ in the stash go up with the goods, at the station's export price.
  // The Bank's marginless ⬢ counter used to be the alternative and is gone:
  // one rate, one place, and the place is the shuttle.
  const resourcesSpent = room.resources ?? 0;
  const payout = goodsResources + resourcesSpent * RESOURCE_EXPORT_PRICE;

  await prisma.$transaction(async (tx) => {
    for (const rt of room.tags) {
      // The `{ ok, poisonedTaken, poisonPayload }` return is deliberately
      // ignored here (spec review nit, M4 fix round) — this is a pure
      // destroy, quantity null, and the shuttle takes the whole stack
      // whatever the landing pad held a moment ago; there is no recipient on
      // the other end to carry poison state onward to. Don't "fix" this into
      // threading poison through a payout that's about to vanish.
      await dropRoomTag(tx, room.id, rt.tagId, null);
      // A runtime crate tag with nothing left pointing at it is litter. The
      // catalog row goes with the last instance.
      if (rt.tag.custom) {
        const stillHeld = await tx.characterTag.count({ where: { tagId: rt.tagId } });
        const stillStashed = await tx.roomTag.count({ where: { tagId: rt.tagId } });
        if (stillHeld === 0 && stillStashed === 0) {
          await tx.tag.delete({ where: { id: rt.tagId } }).catch(() => {});
        }
      }
    }
    if (resourcesSpent > 0) {
      // A conditional decrement, so a concurrent withdrawal from the stash
      // cannot be paid for twice.
      const cleared = await tx.room.updateMany({
        where: { id: room.id, resources: { gte: resourcesSpent } },
        data: { resources: { decrement: resourcesSpent } },
      });
      if (cleared.count === 0) {
        throw new UserError("The stash moved while you were loading. Try again.");
      }
    }
    await bumpAccount(tx, payout);
    await tx.depot.update({
      where: { id: 1 },
      data: { shuttleState: "AWAY", shuttleTurn: openTurn?.number ?? null },
    });

    const effect = {
      direction: "UP",
      soldTags,
      resourcesSpent,
      goodsResources,
      payout,
      roomId: room.id,
    };
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_depot_shuttle_send",
      targetCharacterId: character.id,
      turnId: openTurn?.id ?? null,
      details: effect,
    });
  });

  await speakAtDepot(SHUTTLE_DEPARTED_LINE);
  await refreshShuttleRoom();
  revalidateAll();
  return { payout, sold: soldTags.length };
}

// ─────────────────────────────────────────────────────────────────────────
// The bank
// ─────────────────────────────────────────────────────────────────────────

// The ATM: the account balance on one side, physical coins on the other. This
// is the only door obols enter and leave the world through, which is what
// makes the Merchant the only faucet of currency in the game.
async function depotAtmImpl({ direction: rawDirection, amount: rawAmount }) {
  const { session, character, depot } = await requireLicensedMerchant();

  const direction = rawDirection === "DEPOSIT" ? "DEPOSIT" : "WITHDRAW";
  const amount = Number(rawAmount);
  if (!Number.isInteger(amount) || amount < 1) throw new UserError("That isn't an amount.");

  const obol = await prisma.tag.findUnique({ where: { slug: OBOL_SLUG } });
  if (!obol) throw new UserError("The obol isn't in the catalog yet. A GM needs to run the tag sync.");

  const withdrawing = direction === "WITHDRAW";
  if (withdrawing && (depot.accountObols ?? 0) < amount) {
    throw new UserError(`The account holds ${depot.accountObols ?? 0} ¢.`);
  }

  const held = await prisma.characterTag.findUnique({
    where: { characterId_tagId: { characterId: character.id, tagId: obol.id } },
  });
  if (!withdrawing && (held?.quantity ?? 0) < amount) {
    throw new UserError(`You're carrying ${held?.quantity ?? 0} ¢.`);
  }

  const openTurn = await getOpenTurn();

  await prisma.$transaction(async (tx) => {
    const moved = await bumpAccount(tx, withdrawing ? -amount : amount);
    if (Math.abs(moved.delta) < amount) {
      throw new UserError("The account moved while you were counting. Try again.");
    }
    if (withdrawing) {
      await addToStack(tx, character.id, obol.id, amount, { source: "EVENT", stackable: true });
    } else {
      await dropCharacterTag(tx, character.id, obol.id, amount);
    }

    const effect = { direction, amount, balanceBefore: moved.before, balanceAfter: moved.after };
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_depot_atm",
      targetCharacterId: character.id,
      turnId: openTurn?.id ?? null,
      details: effect,
    });
  });

  await afterInventoryChange(character.id);
  revalidateAll();
  return { direction, amount };
}

// The Company's line, in obols. Drawing puts money in the account; repaying
// takes it back out. The cap is refused rather than clamped, so he is told
// he hit the ceiling instead of quietly getting less than he asked for.
async function depotCreditImpl({ direction: rawDirection, amount: rawAmount }) {
  const { session, character, depot } = await requireLicensedMerchant();

  const draw = rawDirection !== "REPAY";
  const amount = Number(rawAmount);
  if (!Number.isInteger(amount) || amount < 1) throw new UserError("That isn't an amount.");

  if (draw && amount > creditAvailableObols(depot)) {
    throw new UserError(`The line only has ${creditAvailableObols(depot)} ¢ left on it.`);
  }
  if (!draw && amount > (depot.debtObols ?? 0)) {
    throw new UserError(`You only owe ${depot.debtObols ?? 0} ¢.`);
  }
  if (!draw && amount > (depot.accountObols ?? 0)) {
    throw new UserError(`The account only holds ${depot.accountObols ?? 0} ¢.`);
  }

  const openTurn = await getOpenTurn();

  await prisma.$transaction(async (tx) => {
    // The cap is enforced as a conditional update, the way the old ⬢ line was:
    // the write IS the check, so two tabs drawing the last of the line cannot
    // both succeed.
    const { count } = await tx.depot.updateMany({
      where: draw
        ? { id: 1, debtObols: { lte: (depot.creditCapObols ?? 0) - amount } }
        : { id: 1, debtObols: { gte: amount } },
      data: { debtObols: draw ? { increment: amount } : { decrement: amount } },
    });
    if (count === 0) throw new UserError("The line moved while you were drawing. Try again.");

    const moved = await bumpAccount(tx, draw ? amount : -amount);
    const debtAfter = (depot.debtObols ?? 0) + (draw ? amount : -amount);

    const effect = {
      direction: draw ? "DRAW" : "REPAY",
      amount,
      debtBefore: depot.debtObols ?? 0,
      debtAfter,
      balanceAfter: moved.after,
    };
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_depot_credit",
      targetCharacterId: character.id,
      turnId: openTurn?.id ?? null,
      details: effect,
    });
  });

  revalidateAll();
  return { direction: draw ? "DRAW" : "REPAY", amount };
}

// ─────────────────────────────────────────────────────────────────────────
// The station itself
// ─────────────────────────────────────────────────────────────────────────

// The power switch. The one action that does NOT require power, for the
// obvious reason.
//
// Asymmetric on purpose. A Docker may START it — that is the rescue, and the
// whole reason a dead generator should not mean a dead Depot until the
// Merchant next logs in. Only the licence may SHUT IT DOWN, because switching
// the lights off also switches the turret off, and handing a keycard the
// station's off switch hands it the security system.
async function depotGeneratorImpl({ on }) {
  const wanted = Boolean(on);
  const { session, character, depot } = wanted
    ? await requireDepotHand({ needsPower: false })
    : await requireLicensedMerchant({ needsPower: false });

  if (wanted && (depot.generatorFuel ?? 0) <= 0) {
    throw new UserError("It turns over and dies. There's nothing in the tank.");
  }

  const openTurn = await getOpenTurn();

  await prisma.$transaction(async (tx) => {
    await tx.depot.update({ where: { id: 1 }, data: { generatorOn: wanted } });
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: wanted ? "depot_generator_on" : "depot_generator_off",
      targetCharacterId: character.id,
      details: { on: wanted, fuel: depot.generatorFuel ?? 0, turn: openTurn?.number ?? null },
    });
  });

  revalidateAll();
  return { on: wanted };
}

// Shovelling fuel in. Coal is what it wants; saltpeter burns worse and is
// there for the night the coal ran out.
async function depotRefuelImpl({ slug: rawSlug, quantity: rawQuantity }) {
  // A Docker's job, and the one that costs him rather than the station: the
  // coal comes off his own sheet.
  const { session, character, depot } = await requireDepotHand({ needsPower: false });

  const slug = rawSlug === SALTPETER_SLUG ? SALTPETER_SLUG : COAL_SLUG;
  const quantity = normalizeQuantity(rawQuantity);
  if (quantity == null) throw new UserError("That isn't a quantity.");

  const fuelTag = await prisma.tag.findUnique({ where: { slug } });
  if (!fuelTag) throw new UserError("That fuel isn't in the catalog yet.");

  const held = await prisma.characterTag.findUnique({
    where: { characterId_tagId: { characterId: character.id, tagId: fuelTag.id } },
  });
  if ((held?.quantity ?? 0) < quantity) {
    throw new UserError(`You're carrying ${held?.quantity ?? 0} ${fuelTag.name}.`);
  }

  const perUnit = slug === SALTPETER_SLUG ? (depot.saltpeterFuel ?? 0) : (depot.coalFuel ?? 0);
  const openTurn = await getOpenTurn();

  let moved;
  await prisma.$transaction(async (tx) => {
    await dropCharacterTag(tx, character.id, fuelTag.id, quantity);
    // Clamped at the tank's size inside bumpFuel, so overfilling wastes the
    // surplus rather than banking it — `delta` is what actually went in.
    moved = await bumpFuel(tx, perUnit * quantity);

    const effect = {
      slug,
      tagName: fuelTag.name,
      quantity,
      perUnit,
      fuelBefore: moved.before,
      fuelAfter: moved.after,
      wasted: perUnit * quantity - moved.delta,
    };
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_depot_refuel",
      targetCharacterId: character.id,
      turnId: openTurn?.id ?? null,
      details: effect,
    });
  });

  await afterInventoryChange(character.id);
  revalidateAll();
  return { fuelAfter: moved?.after ?? 0, wasted: perUnit * quantity - (moved?.delta ?? 0) };
}

// Arming the gun. The confirm the client shows is a courtesy; this is the
// gate. Note what is NOT checked: whether the Merchant is currently wearing
// his own face. Arming it while concealed is a legal, fatal thing to do, and
// the UI says so in as many words before you press it. Nor is an empty
// merchantFace refused — createActions.js writes it the moment a Merchant is
// created, and the confirm says what happens if somehow it is blank.
async function depotTurretImpl({ armed }) {
  const { session, character, depot } = await requireLicensedMerchant();

  const wanted = Boolean(armed);

  const openTurn = await getOpenTurn();

  await prisma.$transaction(async (tx) => {
    await tx.depot.update({ where: { id: 1 }, data: { turretArmed: wanted } });
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: wanted ? "depot_turret_armed" : "depot_turret_disarmed",
      targetCharacterId: character.id,
      details: { armed: wanted, face: depot.merchantFace ?? "", turn: openTurn?.number ?? null },
    });
  });

  revalidateAll();
  return { armed: wanted };
}

// guarded() RUNS a function; it is not a wrapper factory. Each export has to be
// a real async function that calls it, or a "use server" file ends up exporting
// ten promises and Next refuses to load the whole route.
export async function depotOrder(input) {
  return guarded(() => depotOrderImpl(input));
}

export async function depotCallShuttle() {
  return guarded(() => depotCallShuttleImpl());
}

export async function depotSendShuttle() {
  return guarded(() => depotSendShuttleImpl());
}

export async function depotAtm(input) {
  return guarded(() => depotAtmImpl(input));
}

export async function depotCredit(input) {
  return guarded(() => depotCreditImpl(input));
}

export async function depotGenerator(input) {
  return guarded(() => depotGeneratorImpl(input));
}

export async function depotRefuel(input) {
  return guarded(() => depotRefuelImpl(input));
}

export async function depotTurret(input) {
  return guarded(() => depotTurretImpl(input));
}
