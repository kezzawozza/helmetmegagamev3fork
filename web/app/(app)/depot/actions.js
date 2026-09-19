"use server";

import { revalidatePath } from "next/cache";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { redirect } from "next/navigation";
import {
  prisma,
  MERCHANT_LICENSE_SLUG,
  DEPOT_LOCATION_SLUG,
  DEPOT_KEYCARD_SLUG,
  RAILYARD_ROOM_SLUG,
  normalizeQuantity,
  RESOURCE_IMPORT_PRICE,
  RESOURCE_WARE_ID,
  loadDepot,
  creditAvailableObols,
  placeKeyForRoom,
  canOrder,
  bumpBankAccount,
  manifestOf,
  MANIFEST_GENERAL,
} from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { getOpenTurn } from "@/lib/turn";
import { TURNS_PATH } from "@/lib/routes";
import { logAudit } from "@/lib/requests";
import { blockerFor, ACT } from "@lifeweb/db/lib/incapacitation";
import { UserError, guarded } from "@/lib/actionResult";
import { COMPANY, DEPOT_DEBT, record, turnStamp } from "@lifeweb/db/lib/economyLedger";
import { postMessage } from "@lifeweb/db/lib/discordRest";
import { ambientLine } from "@lifeweb/db/lib/ambientLine";
import { cleanCustomText } from "@lifeweb/db/lib/customText";
import {
  DESTINATIONS,
  counterState,
  openCounterAccount,
  bankMove,
  dropIntoBox,
  depotTurretPanel,
  toggleDepotTurret,
} from "@lifeweb/db/lib/depotCounter";

// The Depot's counter. Everything below is a public endpoint, so everything
// below re-checks the papers AND that you are standing at the Depot — a hangar
// in the caves, not runnable by remote.
//
// What changed in the rework: this is not one man's console any more. Anybody
// standing here may order, off whichever manifests their own tags open
// (db/lib/depotManifests.js), paid out of their own fingerprinted account
// (db/lib/bankAccounts.js). The licence still buys the long shelf and the
// credit line; the keycard still opens the Railyard and cracks a sealed crate.
//
// The counterparty is not in the game: the Company has no balance to debit and
// no stock to run down, so each move touches one side only — and every snapshot
// carries the unit price, so a GM re-tuning docs/tags.yaml next week cannot
// change what a past row says was paid.

// So a fat-fingered cart can't file for ten thousand vials.
const MAX_ORDER_LINES = 40;
// What the Custom crate label may hold. The Buying tab caps its box at the same.
const CRATE_LABEL_MAX = 20;

async function requireDepotStanding() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    include: {
      tags: { include: { tag: true } },
      location: { select: { slug: true, id: true } },
      bankAccount: true,
    },
  });
  if (!character) throw new UserError("You don't have a living character.");
  if (character.location?.slug !== DEPOT_LOCATION_SLUG) {
    throw new UserError("You're not standing at the Depot.");
  }

  // Working a counter is an ACT.
  const blocker = blockerFor(character.tags, ACT);
  if (blocker) throw new UserError(`You can't act — you're ${blocker.name}.`);

  const held = heldSlugSet(character);
  return {
    session,
    character,
    held,
    licensed: held.has(MERCHANT_LICENSE_SLUG),
    keycard: held.has(DEPOT_KEYCARD_SLUG),
  };
}

async function requireLicensedMerchant() {
  const gate = await requireDepotStanding();
  if (!gate.licensed) throw new UserError("You don't have the Merchant's License.");
  return gate;
}

// Standing here with an account. Everything that moves money needs one, and
// opening one is a click, so this refuses with the instruction rather than a rule.
async function requireAccount() {
  const gate = await requireDepotStanding();
  if (!gate.character.bankAccount) {
    throw new UserError("You don't have an account yet.");
  }
  return { ...gate, account: gate.character.bankAccount };
}

function heldSlugSet(character) {
  return new Set(character.tags.map((ct) => ct.tag.slug));
}

function revalidateAll() {
  revalidatePath("/depot");
  revalidatePath("/treasury");
  revalidatePath("/character");
  revalidatePath("/gm/players", "layout");
  revalidatePath(TURNS_PATH, "page");
  revalidatePath("/gm/audit");
}

// A line the room witnesses, spoken into the Depot's Location channel.
// Best-effort, never inside a transaction: a Discord outage must not roll back
// a switch that really was thrown.
async function speakAtDepot(text) {
  if (!text) return;
  const location = await prisma.location
    .findUnique({ where: { slug: DEPOT_LOCATION_SLUG }, select: { discordChannelId: true } })
    .catch(() => null);
  if (!location?.discordChannelId) return;
  await postMessage(location.discordChannelId, ambientLine(text, [], { signed: false })).catch((err) =>
    console.error("Depot ambient line failed:", err),
  );
}

// A bare id select for the audit row's `place`.
async function railyardPlaceKey(tx = prisma) {
  const room = await tx.room.findUnique({ where: { slug: RAILYARD_ROOM_SLUG }, select: { id: true } });
  return room ? placeKeyForRoom(room.id) : null;
}

// ─────────────────────────────────────────────────────────────────────────
// Buying
// ─────────────────────────────────────────────────────────────────────────

// A whole cart in one row. Prices come from the catalog in here; the client's
// are decoration. The obols leave the account NOW and the goods do not exist
// yet — they ride the next train in, which is the whole risk of ordering.
async function depotOrderImpl({ items: rawItems, anonymous: rawAnonymous, label: rawLabel }) {
  const { session, character, held, account } = await requireAccount();

  if (!Array.isArray(rawItems) || rawItems.length === 0) {
    throw new UserError("You didn't order anything.");
  }
  if (rawItems.length > MAX_ORDER_LINES) {
    throw new UserError(`More than ${MAX_ORDER_LINES} line items — split the order.`);
  }

  // Collapse duplicate lines before pricing: the same ware sent twice is one line, not two that each pass the clamp.
  const wanted = new Map();
  for (const item of rawItems) {
    const quantity = normalizeQuantity(item?.quantity);
    if (quantity == null) throw new UserError("That isn't a quantity.");
    wanted.set(item?.tagId ?? "", (wanted.get(item?.tagId ?? "") ?? 0) + quantity);
  }

  // ⬢ is priced and packed by hand rather than through the catalog query below
  // — RESOURCE_WARE_ID is the `resources` tag's own slug, not a cuid, so it can
  // never collide with a real ware's id. It is on the general manifest, so
  // anybody standing here may order it.
  const resourceUnits = wanted.get(RESOURCE_WARE_ID) ?? 0;
  wanted.delete(RESOURCE_WARE_ID);

  const tags = await prisma.tag.findMany({
    where: { id: { in: [...wanted.keys()] }, depotPrice: { not: null } },
  });
  if (tags.length !== wanted.size) throw new UserError("The depot doesn't stock that.");

  let total = 0;
  const lines = [];
  // One order is one manifest's worth, and the widest one it touched is what
  // the row records — the Buying tab carts per section anyway.
  let manifestId = MANIFEST_GENERAL;

  // Over the per-train cap, the ⬢ line is dropped and the rest of the cart is
  // priced — a silent refusal, not a message. The Buying tab's number input is
  // capped already, so an honest click never gets here; a hand-built request
  // buys the wares it asked for and no ⬢.
  if (resourceUnits > 0 && normalizeQuantity(resourceUnits) != null) {
    total += RESOURCE_IMPORT_PRICE * resourceUnits;
    // No tagId marks it as Resources downstream (db/lib/depotCrates.js packs it).
    lines.push({ name: "Resources", quantity: resourceUnits, unitPrice: RESOURCE_IMPORT_PRICE, sealed: false });
  }
  for (const tag of tags) {
    // The manifest gate, re-checked here and never taken from the client — the
    // section a ware was carted from is a hint, the tag is the rule.
    if (!canOrder(tag, held)) {
      throw new UserError(`The counter doesn't offer you ${tag.name}.`);
    }
    manifestId = manifestOf(tag);

    const quantity = wanted.get(tag.id);
    // Re-clamped after the merge, not just each submitted line — else two lines of 99 would slip 198 through.
    if (normalizeQuantity(quantity) == null) {
      throw new UserError(`That's more ${tag.name} than the depot will put on one train.`);
    }
    // Non-stackable wares are unique per character (CharacterTag), so ordering two would charge for two, deliver one.
    if (!tag.stackable && quantity > 1) {
      throw new UserError(`The depot can't ship more than one ${tag.name}.`);
    }
    total += tag.depotPrice * quantity;
    lines.push({
      tagId: tag.id,
      name: tag.name,
      quantity,
      unitPrice: tag.depotPrice,
      sealed: Boolean(tag.sealedShipping),
    });
  }

  // The catalog prices in ¢ (DEPOT.md §0), so the cart total IS the price.
  if ((account.balanceObols ?? 0) < total) {
    throw new UserError(`That order is ${total} ¢ and your account holds ${account.balanceObols ?? 0}.`);
  }

  const openTurn = await getOpenTurn();
  // A custom label is its own choice; sent alongside anonymous, the label wins.
  let label = null;
  if (rawLabel != null) {
    if (typeof rawLabel !== "string" || rawLabel.length > CRATE_LABEL_MAX) {
      throw new UserError(`A label is at most ${CRATE_LABEL_MAX} characters.`);
    }
    label = cleanCustomText(rawLabel, CRATE_LABEL_MAX);
    if (!label) throw new UserError("Write something on the label, or pick another option.");
  }
  const anonymous = !label && Boolean(rawAnonymous);

  await prisma.$transaction(async (tx) => {
    // bumpBankAccount's conditional clamp enforces the balance; the check
    // against `delta` is what refuses rather than quietly buying less.
    const moved = await bumpBankAccount(tx, account.id, -total, {
      holderName: account.holderName,
      econ: { other: COMPANY, reason: "DEPOT_ORDER", ...turnStamp(openTurn) },
    });
    if (-moved.delta < total) {
      throw new UserError("Your account was edited. Try again.");
    }

    await tx.depotOrder.create({
      data: {
        accountId: account.id,
        fingerprint: account.fingerprint,
        holderName: account.holderName,
        anonymous,
        label,
        lines,
        totalObols: total,
        manifestId,
        placedTurn: openTurn?.number ?? 0,
      },
    });

    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_depot_order",
      targetCharacterId: character.id,
      place: await railyardPlaceKey(tx),
      turnId: openTurn?.id ?? null,
      details: { lines, total, manifestId, anonymous, label, fingerprint: account.fingerprint },
    });
  });

  revalidateAll();
  return { lines: lines.length, total };
}

// ─────────────────────────────────────────────────────────────────────────
// The fixtures: the counter, the drop box, the ATM, the gun
// ─────────────────────────────────────────────────────────────────────────

// Each of these is a thing on a wall, reachable from Chat's place panel and
// from a Discord button as well as from this page, so the rules live once in
// db/lib/depotCounter.js and both faces call them. What is left here is the
// web's own half: the session, the turn, and telling Next what to re-render.
//
// depotCounter returns `{ ok: false, error }` rather than throwing; `lift`
// turns that into the UserError `guarded` already knows how to answer with.
function lift(result) {
  if (!result?.ok) throw new UserError(result?.error ?? "That didn't work.");
  return result;
}

async function whoAmI() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  return session;
}

async function depotOpenAccountImpl() {
  const session = await whoAmI();
  const openTurn = await getOpenTurn();
  const result = lift(
    await openCounterAccount(prisma, session.discordUserId, {
      turnNumber: openTurn?.number ?? null,
      turnId: openTurn?.id ?? null,
    }),
  );
  revalidateAll();
  return { fingerprint: result.fingerprint };
}

async function depotDropImpl(input) {
  const session = await whoAmI();
  const openTurn = await getOpenTurn();
  const result = lift(await dropIntoBox(prisma, session.discordUserId, { ...input, turn: openTurn }));
  await afterInventoryChange(result.characterId);
  revalidateAll();
  return { tagName: result.tagName, quantity: result.quantity };
}

async function depotBankImpl(input) {
  const session = await whoAmI();
  const openTurn = await getOpenTurn();
  const result = lift(await bankMove(prisma, session.discordUserId, { ...input, turn: openTurn }));
  await afterInventoryChange(result.characterId);
  revalidateAll();
  return { direction: result.direction, amount: result.amount };
}

async function depotCounterStateImpl() {
  const session = await whoAmI();
  return lift(await counterState(prisma, session.discordUserId));
}

async function depotTurretPanelImpl() {
  const session = await whoAmI();
  return lift(await depotTurretPanel(prisma, session.discordUserId));
}

async function depotTurretImpl(input) {
  const session = await whoAmI();
  const openTurn = await getOpenTurn();
  const result = lift(await toggleDepotTurret(prisma, session.discordUserId, { ...input, turn: openTurn }));
  await speakAtDepot(result.ambient);
  revalidateAll();
  return { armed: result.armed, line: result.line };
}

// Re-pointing a staged sale before the train takes it. Web-only: a table with a
// dropdown per row is not a thing Discord can draw, and settled rows are
// read-only anyway.
async function depotSaleDestinationImpl({ saleId, destination: rawDestination }) {
  const session = await whoAmI();
  const state = lift(await counterState(prisma, session.discordUserId));
  if (!state.account) throw new UserError("You don't have an account yet.");

  const destination = DESTINATIONS.has(rawDestination) ? rawDestination : "SELF";
  if (destination === "MERCHANT" && !state.canSellToMerchant) {
    throw new UserError("You don't have the Merchant's License or a Depot Keycard.");
  }

  // The WHERE is the ownership check and the settled check at once — never a
  // read followed by a write, which a departure could land between.
  const { count } = await prisma.depotSale.updateMany({
    where: {
      id: String(saleId ?? ""),
      account: { fingerprint: state.account.fingerprint },
      settledAt: null,
    },
    data: { destination },
  });
  // No row updated means the train settled it between the click and here.
  // Nothing to say — the refresh redraws it under Sold, which is the answer.
  revalidateAll();
  return { destination, settled: count === 0 };
}

// ─────────────────────────────────────────────────────────────────────────
// The Company's line
// ─────────────────────────────────────────────────────────────────────────

// Draw puts money in the Merchant's own account, repay takes it back out.
// Refused at the cap, never clamped — he is told he hit the ceiling.
async function depotCreditImpl({ direction: rawDirection, amount: rawAmount }) {
  const { session, character } = await requireLicensedMerchant();
  const account = character.bankAccount;
  if (!account) throw new UserError("You don't have an account yet.");

  const depot = await loadDepot(prisma);
  const draw = rawDirection !== "REPAY";
  const amount = Number(rawAmount);
  if (!Number.isInteger(amount) || amount < 1) throw new UserError("That isn't an amount.");

  if (draw && amount > creditAvailableObols(depot)) {
    throw new UserError(`The line only has ${creditAvailableObols(depot)} ¢ left on it.`);
  }
  if (!draw && amount > (depot.debtObols ?? 0)) {
    throw new UserError(`You only owe ${depot.debtObols ?? 0} ¢.`);
  }
  if (!draw && amount > (account.balanceObols ?? 0)) {
    throw new UserError(`Your account only holds ${account.balanceObols ?? 0} ¢.`);
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
    if (count === 0) throw new UserError("The line was edited. Try again.");

    // Two legs: the debt itself (form DEBT) and the cash it puts in the account (form ACCOUNT); repay is the same pair backward.
    await record(
      tx,
      { from: draw ? COMPANY : DEPOT_DEBT, to: draw ? DEPOT_DEBT : COMPANY, form: "DEBT", amount },
      { reason: "DEPOT_CREDIT", ...turnStamp(openTurn) },
    );
    const moved = await bumpBankAccount(tx, account.id, draw ? amount : -amount, {
      holderName: account.holderName,
      econ: { other: COMPANY, reason: "DEPOT_CREDIT", ...turnStamp(openTurn) },
    });

    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_depot_credit",
      targetCharacterId: character.id,
      place: await railyardPlaceKey(tx),
      turnId: openTurn?.id ?? null,
      details: {
        direction: draw ? "DRAW" : "REPAY",
        amount,
        debtBefore: depot.debtObols ?? 0,
        debtAfter: (depot.debtObols ?? 0) + (draw ? amount : -amount),
        balanceAfter: moved.after,
      },
    });
  });

  revalidateAll();
  return { direction: draw ? "DRAW" : "REPAY", amount };
}

// ─── The exported surface. `guarded` turns a UserError into { ok: false }. ───

export async function depotCounterState() {
  return guarded(() => depotCounterStateImpl());
}

export async function depotOpenAccount() {
  return guarded(() => depotOpenAccountImpl());
}

export async function depotOrder(input) {
  return guarded(() => depotOrderImpl(input));
}

export async function depotDrop(input) {
  return guarded(() => depotDropImpl(input));
}

export async function depotSaleDestination(input) {
  return guarded(() => depotSaleDestinationImpl(input));
}

export async function depotBank(input) {
  return guarded(() => depotBankImpl(input));
}

export async function depotCredit(input) {
  return guarded(() => depotCreditImpl(input));
}

export async function depotTurret(input) {
  return guarded(() => depotTurretImpl(input));
}

export async function depotTurretRead() {
  return guarded(() => depotTurretPanelImpl());
}
