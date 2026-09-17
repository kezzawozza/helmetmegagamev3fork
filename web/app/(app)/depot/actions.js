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
  placeKeyForRoom,
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
import { COMPANY, DEPOT_ACCOUNT, DEPOT_DEBT, characterParty, record, turnStamp } from "@lifeweb/db/lib/economyLedger";
import { refreshLiveRooms } from "@lifeweb/db/lib/syncZones";
import { resourcesOf, takeRoomResources } from "@lifeweb/db/lib/resourceStack";

// The Merchant's station. Same contract as every other player Request
// (docs/systemdocs/REQUESTS.md): authenticate, re-validate everything the
// client sent, then apply the effect and write the Request + AuditLog rows in
// ONE transaction, auto-passed for a GM to review after.
//
// Two things differ here. The money is obols, on the Depot row rather than
// anybody's character — the licence is tradeable, so handing it over hands
// over the account, and nothing below reads `character.resources` for a
// price. And the counterparty is not in the game: the orbital station has no
// balance to debit and no stock to run down, so each move touches one side
// only — every snapshot below carries the unit price so a GM re-tuning
// docs/tags.yaml next week can't change what an Undo reverses.

// So a fat-fingered manifest can't file for ten thousand vials.
const MAX_ORDER_LINES = 40;

// A page gate is advisory; a server action is a public endpoint. Everything
// below re-checks the papers AND that you are standing at the Depot — a
// hangar in the caves, not runnable by remote.
//
// Two doors, deliberately split. `requireLicensedMerchant` is the money and
// the gun (ordering, the ATM, the credit line, the turret) — the LICENCE, not
// the merchant ROLE, since the licence is tradeable. `requireDepotHand` is the
// labour (shuttle, generator) — a Depot Keycard is enough, so a Docker can
// keep the station moving while the Merchant sleeps. None spends an obol or points the gun.
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

  // Working a console is an ACT.
  const blocker = blockerFor(character.tags, ACT);
  if (blocker) throw new UserError(`You can't do that right now. You're ${blocker.name}.`);

  const depot = await loadDepot(prisma);

  // Checked here, not trusted from the client's disabled button. The power switch and fuel hatch must work in the dark.
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

// A licence opens this too — the Merchant isn't locked out by holding the better card.
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
  // Every consumer of this guard is an ACT, so the gate sits here once.
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

// A line the room witnesses, spoken into the Depot's Location channel.
// Best-effort, never inside the transaction: a Discord outage must not roll back a shuttle that really did land.
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

// A bare id select, not the full landingPad() lookup — most call sites already resolved the rest.
async function landingPadRoomId(tx = prisma) {
  const room = await tx.room.findUnique({ where: { slug: LANDING_PAD_SLUG }, select: { id: true } });
  return room ? placeKeyForRoom(room.id) : null;
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
// come from the catalog in here; the client's are decoration. The obols leave
// the account NOW and the goods don't exist yet — the whole risk of the
// business, and why the shuttle clock matters.
async function depotOrderImpl({ items: rawItems }) {
  const { session, character, depot } = await requireLicensedMerchant();

  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new UserError("Nothing on the manifest.");
  }
  if (rawItems.length > MAX_ORDER_LINES) {
    throw new UserError(`That's more than ${MAX_ORDER_LINES} line items. Split the order.`);
  }

  // Collapse duplicate lines before pricing: the same ware sent twice is one line, not two that each pass the clamp.
  const wanted = new Map();
  for (const item of rawItems) {
    const quantity = normalizeQuantity(item?.quantity);
    if (quantity == null) throw new UserError("That isn't a quantity the Depot will handle.");
    wanted.set(item?.tagId ?? "", (wanted.get(item?.tagId ?? "") ?? 0) + quantity);
  }

  // ⬢ is priced and packed by hand here rather than through the catalog
  // query below — RESOURCE_WARE_ID is the `resources` tag's own slug, not a
  // cuid, so it can never collide with a real ware's id, and pulling it out
  // first keeps the loop below from having to special-case one row.
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
    // No tagId marks it as Resources downstream (db/lib/depotCrates.js packs it).
    lines.push({
      name: "Resources",
      quantity: resourceUnits,
      unitPrice: RESOURCE_IMPORT_PRICE,
      sealed: false,
    });
  }
  for (const tag of tags) {
    const quantity = wanted.get(tag.id);
    // Re-clamped after the merge, not just each submitted line — else two lines of 99 would slip 198 through.
    if (normalizeQuantity(quantity) == null) {
      throw new UserError(`That's more ${tag.name} than the station will put on one shuttle.`);
    }
    // Non-stackable wares are unique per character (CharacterTag), so ordering two would charge for two, deliver one.
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

  // The catalog prices in ⬢ and an obol is one ⬢, so the cart total IS the price. See db/lib/depotState.js.
  const total = totalResources;
  if ((depot.accountObols ?? 0) < total) {
    throw new UserError(`That order is ${total} ¢ and the account holds ${depot.accountObols ?? 0}.`);
  }

  const openTurn = await getOpenTurn();
  const existing = Array.isArray(depot.manifest) ? depot.manifest : [];

  await prisma.$transaction(async (tx) => {
    // bumpAccount's conditional clamp enforces the balance — two tabs ordering the last of the money can't both succeed.
    const moved = await bumpAccount(tx, -total, { econ: { to: COMPANY, reason: "DEPOT_ORDER" , ...turnStamp(openTurn) } });
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
      place: await landingPadRoomId(tx),
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
// (db/lib/roomLive.js), so every move has to repaint it. Best effort — a
// Discord hiccup must not fail a shipment that already committed.
async function refreshShuttleRoom() {
  await refreshLiveRooms(prisma, "shuttle").catch((err) =>
    console.error("landing pad refresh failed:", err.message),
  );
}

// Calling it down. Everything on the manifest becomes crates on the landing
// pad; an empty manifest still brings the shuttle, because he also needs it
// down to load goods going the other way.
async function depotCallShuttleImpl() {
  // A Docker's job: the obols already left when the manifest was written, so the worst a keycard can do is bring it down early.
  const { session, character, depot } = await requireDepotHand();

  if (depot.shuttleState !== "AWAY") {
    throw new UserError("The shuttle is already down.");
  }

  const room = await landingPad();
  const manifest = Array.isArray(depot.manifest) ? depot.manifest : [];
  const openTurn = await getOpenTurn();

  const shipment = shipmentId();

  // Crates need a group to render like any other item; "items-gear" is the catalog's catch-all for carried objects.
  const group = await prisma.tagGroup.findUnique({ where: { slug: "items-gear" } });

  // Weights are needed BEFORE the split: a crate is packed by weight, not by
  // counting things in. A resources line has no tagId, priced at RESOURCE_UNIT_LBS inside the packer.
  const innerWeights = await prisma.tag.findMany({
    where: { id: { in: [...new Set(manifest.map((m) => m.tagId).filter(Boolean))] } },
    select: { id: true, weightLbs: true },
  });
  const weightByTagId = new Map(innerWeights.map((t) => [t.id, t.weightLbs ?? 0]));

  const crates = splitIntoCrates(manifest, { weightByTagId });

  await prisma.$transaction(async (tx) => {
    for (const data of crateTagData(shipment, crates, { groupId: group?.id ?? null, weightByTagId })) {
      const { crateContents, ...tagFields } = data;
      // ephemeral: game state, not catalog — a Restart Game sweeps every crate still on the landing pad (TAGS.md §5d).
      const tag = await tx.tag.create({ data: { ...tagFields, crateContents, ephemeral: true } });
      await addToRoomStack(tx, room.id, tag.id, 1);
    }

    await tx.depot.update({
      where: { id: 1 },
      data: {
        shuttleState: "DOCKED",
        // NEVER null — a null clock read "landed this turn" forever, wedging the shuttle. 0 is the floor: an already-elapsed turn.
        shuttleTurn: openTurn?.number ?? 0,
        manifest: [],
      },
    });

    const effect = { shipment, crates: crates.length, manifest, roomId: room.id };
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_depot_shuttle_call",
      targetCharacterId: character.id,
      place: await landingPadRoomId(tx),
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
  // Also a Docker's job, and the sharper of the two: a keycard can sell everything on the pad; the payout goes to the station's account either way.
  const { session, character, depot } = await requireDepotHand();

  if (depot.shuttleState !== "DOCKED") throw new UserError("The shuttle isn't here.");

  const openTurn = await getOpenTurn();
  const landed = depot.shuttleTurn ?? 0;
  const cooldown = depot.shuttleCooldown ?? 0;
  if (openTurn && openTurn.number - landed < cooldown) {
    throw new UserError("It only just landed. Give the crew a turn to work.");
  }

  const room = await landingPad();

  let goodsResources = 0;
  const soldTags = [];

  // ⬢ sitting in the room is its own stack now (room.resources below), not a
  // ware among the others — pulled out here so the goods loop never resells
  // it a second time at the ordinary sellablePrice.
  const goodsTags = room.tags.filter((rt) => rt.tag.slug !== RESOURCE_WARE_ID);

  // A crate has no sellablePrice of its own — it's a box. Sending one back
  // unopened pays for what is INSIDE it, priced off the live catalog (the crate only stores names and counts).
  const crateInner = goodsTags.filter((rt) => Array.isArray(rt.tag.crateContents));
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

  for (const rt of goodsTags) {
    const contents = Array.isArray(rt.tag.crateContents) ? rt.tag.crateContents : null;
    const unit = contents
      ? contents.reduce((sum, c) => sum + (innerPrice.get(c.tagId) ?? 0) * c.quantity, 0) +
        // ⬢ packed into the crate are worth what loose ⬢ are worth — same reason as the crate-contents pricing above.
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
  // Loose ⬢ in the stash go up with the goods, at the station's export price — one rate, one place: the shuttle.
  const resourcesSpent = resourcesOf(room);
  const payout = goodsResources + resourcesSpent * RESOURCE_EXPORT_PRICE;

  await prisma.$transaction(async (tx) => {
    for (const rt of goodsTags) {
      // The `{ ok, poisonedTaken, poisonPayload }` return is deliberately
      // ignored: pure destroy, quantity null, no recipient to carry poison
      // state onward. Don't thread poison through a payout that's about to vanish.
      // Goods go to the Company, not a burn — the other leg of the payout below.
      await dropRoomTag(tx, room.id, rt.tagId, null, { econ: { to: COMPANY, reason: "DEPOT_SALE" , ...turnStamp(openTurn) } });
      // A runtime crate tag with nothing pointing at it is litter; the catalog row goes with the last instance.
      if (rt.tag.custom) {
        const stillHeld = await tx.characterTag.count({ where: { tagId: rt.tagId } });
        const stillStashed = await tx.roomTag.count({ where: { tagId: rt.tagId } });
        if (stillHeld === 0 && stillStashed === 0) {
          await tx.tag.delete({ where: { id: rt.tagId } }).catch(() => {});
        }
      }
    }
    if (resourcesSpent > 0) {
      // A conditional decrement, so a concurrent withdrawal can't be paid for twice.
      const cleared = await takeRoomResources(tx, room.id, resourcesSpent);
      if (!cleared) {
        throw new UserError("The stash moved while you were loading. Try again.");
      }
      // Booked by hand since this conditional decrement isn't a moveParty call — without it the stash silently drifts.
      await record(
        tx,
        { from: { kind: "room", id: room.id, name: room.name }, to: COMPANY, form: "BALANCE", amount: resourcesSpent },
        { reason: "DEPOT_SALE", ...turnStamp(openTurn) },
      );
    }
    // Mirror of an order's money leaving.
    await bumpAccount(tx, payout, { econ: { from: COMPANY, reason: "DEPOT_SALE" , ...turnStamp(openTurn) } });
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
      place: await landingPadRoomId(tx),
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

// The ATM: account balance on one side, coins on the other — the only door obols enter and leave the world through.
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
    // A form change, not a mint or burn. ONE row records it (the coin leg
    // below); bumpAccount gets no `econ` — booking both legs double-counted
    // the ATM in Top Movers and the Accounts columns, which don't filter by form.
    const merchant = characterParty(character);
    const moved = await bumpAccount(tx, withdrawing ? -amount : amount);
    if (Math.abs(moved.delta) < amount) {
      throw new UserError("The account moved while you were counting. Try again.");
    }
    if (withdrawing) {
      await addToStack(tx, character.id, obol.id, amount, {
        source: "EVENT",
        stackable: true,
        econ: { from: DEPOT_ACCOUNT, to: merchant, reason: "DEPOT_ATM", ...turnStamp(openTurn) },
      });
    } else {
      await dropCharacterTag(tx, character.id, obol.id, amount, {
        econ: { from: merchant, to: DEPOT_ACCOUNT, reason: "DEPOT_ATM", ...turnStamp(openTurn) },
      });
    }

    const effect = { direction, amount, balanceBefore: moved.before, balanceAfter: moved.after };
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_depot_atm",
      targetCharacterId: character.id,
      place: await landingPadRoomId(tx),
      turnId: openTurn?.id ?? null,
      details: effect,
    });
  });

  await afterInventoryChange(character.id);
  revalidateAll();
  return { direction, amount };
}

// The Company's line, in obols. Draw puts money in, repay takes it out. Refused, not clamped — told he hit the ceiling.
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
    // A conditional update — the write IS the check, so two tabs drawing the last of the line can't both succeed.
    const { count } = await tx.depot.updateMany({
      where: draw
        ? { id: 1, debtObols: { lte: (depot.creditCapObols ?? 0) - amount } }
        : { id: 1, debtObols: { gte: amount } },
      data: { debtObols: draw ? { increment: amount } : { decrement: amount } },
    });
    if (count === 0) throw new UserError("The line moved while you were drawing. Try again.");

    // Two legs: the debt itself (form DEBT) and the cash it puts in the account (form ACCOUNT); repay is the same pair backward.
    await record(
      tx,
      {
        from: draw ? COMPANY : DEPOT_DEBT,
        to: draw ? DEPOT_DEBT : COMPANY,
        form: "DEBT",
        amount,
      },
      { reason: "DEPOT_CREDIT", ...turnStamp(openTurn) },
    );
    const moved = await bumpAccount(tx, draw ? amount : -amount, {
      econ: draw
        ? { from: COMPANY, reason: "DEPOT_CREDIT", ...turnStamp(openTurn) }
        : { to: COMPANY, reason: "DEPOT_CREDIT", ...turnStamp(openTurn) },
    });
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
      place: await landingPadRoomId(tx),
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

// The power switch, the one action that does NOT require power. Asymmetric
// on purpose: a Docker may START it (the rescue), but only the licence may
// SHUT IT DOWN — the lights also switch off the turret, so a keycard would get the security system too.
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
      place: await landingPadRoomId(tx),
      details: { on: wanted, fuel: depot.generatorFuel ?? 0, turn: openTurn?.number ?? null },
    });
  });

  revalidateAll();
  return { on: wanted };
}

// Shovelling fuel in. Coal is what it wants; saltpeter burns worse and covers the night the coal ran out.
async function depotRefuelImpl({ slug: rawSlug, quantity: rawQuantity }) {
  // Costs the Docker, not the station.
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
    // Clamped at tank size; overfilling wastes the surplus, `delta` is what went in.
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
      place: await landingPadRoomId(tx),
      turnId: openTurn?.id ?? null,
      details: effect,
    });
  });

  await afterInventoryChange(character.id);
  revalidateAll();
  return { fuelAfter: moved?.after ?? 0, wasted: perUnit * quantity - (moved?.delta ?? 0) };
}

// Arming the gun. The client's confirm is a courtesy; this is the gate. Not
// checked: whether the Merchant is wearing his own face — arming it
// concealed is legal and fatal, and the UI says so before you press it.
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
      place: await landingPadRoomId(tx),
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
