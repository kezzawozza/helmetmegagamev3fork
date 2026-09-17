"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { guarded, UserError } from "@/lib/actionResult";
import { getOpenTurn } from "@/lib/turn";
import { logAudit } from "@/lib/requests";
import { requireFreeMove, fileAutoRoutine } from "@/lib/moveSpend";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { accessibleRooms, roomAccessKeys } from "@lifeweb/db/lib/roomAccess";
import { grantTagSlugs, addToRoomStack, dropRoomTag, clampEquippedQuantity } from "@lifeweb/db/lib/tagWrites";
import { record, BURN, turnStamp } from "@lifeweb/db/lib/economyLedger";
import {
  readCharacterResources,
  readRoomResources,
  takeCharacterResources,
  takeRoomResources,
} from "@lifeweb/db/lib/resourceStack";
import { announceInRoom } from "@lifeweb/db/lib/roomAnnounce";
import {
  THANATI_SLUG,
  THANATI_LEADER_SLUG,
  RECOVERABLE_SLUGS,
  THANATI_WARES,
  OBOL_SLUG,
  listComrades,
  hideoutRoom,
} from "@lifeweb/db/lib/thanati";

// The THANATI section of the character panel (docs/systemdocs/THANATI.md):
// Recall Comrades, Recover Equipment, Set Hideout, Purchase Gear. Each one
// resolves the cultist from the session, never from a posted id, and
// re-checks the tag the button's `show` already read — a server action is a
// public endpoint and a hidden button is a hint, not a lock.

async function cultist() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const me = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: {
      id: true,
      name: true,
      age: true,
      gender: true,
      locationId: true,
      zoneId: true,
      discordUserId: true,
      tags: { where: { quantity: { gt: 0 } }, select: { tag: { select: { slug: true } } } },
    },
  });
  if (!me) redirect("/character");
  const slugs = new Set(me.tags.map((ct) => ct.tag.slug));
  if (!slugs.has(THANATI_SLUG)) throw new UserError("Not yours to press.");
  return { session, me, slugs };
}

function revalidate() {
  revalidatePath("/character");
  revalidatePath("/gm/audit");
}

// ---- Recall Comrades -------------------------------------------------------
// The roster comes back to the page that asked, as a notice under the
// cultist's own cursor — private already, so it no longer goes out as a DM
// too. Costs nothing and spends no Move.
async function recallComradesImpl() {
  const { session, me } = await cultist();
  const rows = await listComrades(prisma);
  await logAudit(prisma, {
    actorDiscordUserId: session.discordUserId,
    actionType: "request_recall_comrades",
    targetCharacterId: me.id,
    details: { comrades: rows.map((r) => r.name) },
  });
  revalidate();
  return {
    ok: true,
    roster: rows.map((r) => ({ name: r.name, role: r.role, leader: r.leader })),
    line: rows.length ? "Your comrades." : "You are the last of them.",
  };
}

// ---- Recover Equipment -----------------------------------------------------
// Hands back whichever of the robes and the mask the cultist is not holding.
// Spends the Move, and not on two turns running: the previous turn's row in
// the audit log is the cooldown, the same way the medic's ration counts rows
// (REQUESTS.md §1a), so it needs no column of its own.
const RECOVER_ACTION = "request_recover_equipment";

async function recoverEquipmentImpl() {
  const { session, me, slugs } = await cultist();
  const missing = RECOVERABLE_SLUGS.filter((slug) => !slugs.has(slug));
  if (missing.length === 0) throw new UserError("You already hold both.");

  const openTurn = await getOpenTurn();
  await requireFreeMove(me, openTurn);

  const recentTurns = await prisma.turn.findMany({
    where: { number: { in: [openTurn.number, openTurn.number - 1] } },
    select: { id: true },
  });
  const recent = await prisma.auditLog.count({
    where: {
      actionType: RECOVER_ACTION,
      actorDiscordUserId: session.discordUserId,
      turnId: { in: recentTurns.map((t) => t.id) },
    },
  });
  if (recent > 0) throw new UserError("Not again so soon.");

  const granted = await prisma.$transaction(async (tx) => {
    const rows = await grantTagSlugs(tx, me.id, missing, openTurn.number);
    await fileAutoRoutine(tx, me, openTurn, "Recovered equipment.", "auto:recover");
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: RECOVER_ACTION,
      targetCharacterId: me.id,
      turnId: openTurn.id,
      details: { granted: rows.map((r) => r.tagName) },
    });
    return rows;
  });
  await afterInventoryChange([me.id]);
  revalidate();
  const names = granted.map((r) => r.tagName);
  return {
    ok: true,
    granted: names,
    line: `${names.join(" and ")} back in your hands — and that's your Move for the turn.`,
  };
}

// ---- Set Hideout -----------------------------------------------------------
// Leader only. The room must be at the leader's own Location and behind a door
// they can open — the same accessibleRooms every other door in the game reads.
async function setHideoutImpl({ roomId }) {
  const { session, me, slugs } = await cultist();
  if (!slugs.has(THANATI_LEADER_SLUG)) throw new UserError("Not yours to press.");
  const room = await prisma.room.findUnique({
    where: { id: String(roomId ?? "") },
    select: { id: true, name: true, kind: true, locationId: true, accessTagSlugs: true },
  });
  if (!room || room.locationId !== me.locationId) throw new UserError("That room isn't here.");
  const keys = await roomAccessKeys(prisma, me.id);
  if (accessibleRooms([room], keys.heldSlugs, keys.guestRoomIds, keys.allowedRoomIds).length === 0) {
    throw new UserError("That door is locked.");
  }
  // NOT a faction silo. A silo is an ordinary Room with a pointer on the
  // Faction (FACTIONS.md), so nothing else here would have stopped it — and
  // Purchase Gear spends whatever is on the hideout floor, which would have
  // turned a treasury into a cult shelf for anyone standing at that Location.
  const silo = await prisma.faction.findFirst({ where: { siloRoomId: room.id }, select: { id: true } });
  if (silo) throw new UserError("Not in a faction's silo.");
  await prisma.gameState.update({ where: { id: 1 }, data: { thanatiHideoutRoomId: room.id } });
  await logAudit(prisma, {
    actorDiscordUserId: session.discordUserId,
    actionType: "thanati_hideout_set",
    targetCharacterId: me.id,
    details: { roomId: room.id, room: room.name },
  });
  revalidate();
  return { ok: true, room: room.name };
}

// ---- Purchase Gear ---------------------------------------------------------
// The shelf takes BOTH currencies out of BOTH purses. An obol is one ⬢
// (DEPOT.md), so there is one price per ware and four pools to pay it from:
// the hideout floor's ⬢ and obols, and the buyer's own. The two controls are
// PREFERENCES, not restrictions — they say which pool drains first, and the
// rest cover whatever is left. Anything else meant a cult sitting on 200 ⬢
// across four piles being told it could not afford a 30 ⬢ stick.
//
// Decrement-as-check on every pool, the room-stash rule (CARRY.md): two
// cultists buying at once must not overdraw. The goods still land on the
// hideout floor whoever paid — the cult stockpiles there.
function formatGoods(lines) {
  return lines.map((l) => (l.quantity > 1 ? `${l.name} ×${l.quantity}` : l.name)).join(", ");
}

// The shelf is ten wares long, so a cart longer than this is a crafted POST
// rather than a player.
const MAX_CART_LINES = 40;

// A guarded decrement on a character's stack. dropCharacterTag reads first and
// then writes, which is the wrong shape for money.
async function spendCharacterTag(tx, characterId, tagId, quantity) {
  const { count } = await tx.characterTag.updateMany({
    where: { characterId, tagId, quantity: { gte: quantity } },
    data: { quantity: { decrement: quantity } },
  });
  if (count === 0) return false;
  await tx.characterTag.deleteMany({ where: { characterId, tagId, quantity: { lte: 0 } } });
  await clampEquippedQuantity(tx, characterId, tagId);
  return true;
}

async function purchaseGearImpl({ items, currency, purse }) {
  const { session, me } = await cultist();
  const hideout = await hideoutRoom(prisma);
  if (!hideout) throw new UserError("Set a hideout first.");
  if (hideout.locationId !== me.locationId) throw new UserError("Not at the hideout.");
  // THE BUYER'S OWN KEY, not the leader's. Standing at the Location was the
  // only gate before, so a cultist who could not open the hideout door still
  // spent what was behind it — and the goods landed in a room they could not
  // enter. Set Hideout has always run this check; this is the same one.
  const buyerKeys = await roomAccessKeys(prisma, me.id);
  if (accessibleRooms([hideout], buyerKeys.heldSlugs, buyerKeys.guestRoomIds, buyerKeys.allowedRoomIds).length === 0) {
    throw new UserError("That door is locked.");
  }
  const currencyFirst = currency === "obols" ? "obols" : "resources";
  const purseFirst = purse === "self" ? "self" : "room";

  const wanted = Array.isArray(items) ? items : [];
  const wareBySlug = new Map(THANATI_WARES.map((w) => [w.slug, w]));
  const tags = await prisma.tag.findMany({
    where: { slug: { in: [...wareBySlug.keys(), OBOL_SLUG] } },
    select: { id: true, slug: true, name: true },
  });
  const tagById = new Map(tags.map((t) => [t.id, t]));
  const obolTag = tags.find((t) => t.slug === OBOL_SLUG);

  // FOLDED BY TAG, and capped after folding. A posted cart is arbitrary: two
  // lines of the same ware would otherwise each get their own 99, and an
  // enormous list would be priced and written one round-trip at a time inside
  // an interactive transaction until Prisma's timeout killed it.
  const byTag = new Map();
  for (const raw of wanted.slice(0, MAX_CART_LINES)) {
    const tag = tagById.get(String(raw?.tagId ?? ""));
    const ware = tag ? wareBySlug.get(tag.slug) : null;
    const quantity = Math.trunc(Number(raw?.quantity));
    if (!ware || !Number.isInteger(quantity) || quantity < 1) continue;
    const existing = byTag.get(tag.id);
    if (existing) existing.quantity += quantity;
    else byTag.set(tag.id, { tagId: tag.id, name: tag.name, quantity, each: ware.price });
  }
  const lines = [...byTag.values()].map((l) => ({ ...l, quantity: Math.min(l.quantity, 99) }));
  if (lines.length === 0) throw new UserError("Nothing to buy.");
  const total = lines.reduce((sum, l) => sum + l.each * l.quantity, 0);

  // Purse is the outer preference and currency the inner one, so "room first,
  // obols first" reads room obols, room ⬢, own obols, own ⬢.
  const purses = purseFirst === "self" ? ["self", "room"] : ["room", "self"];
  const currencies = currencyFirst === "obols" ? ["obols", "resources"] : ["resources", "obols"];
  const order = purses.flatMap((k) => currencies.map((c) => `${k}:${c}`));

  // PLANNED INSIDE THE TRANSACTION, off a read taken there. Planning outside
  // it meant a pool that shrank in between refused the whole purchase — two
  // cultists both planning against the same thirty obols, and the second told
  // "not enough there" with three hundred ⬢ in their own pocket. The draw is
  // re-derived here, so the second one simply pays from somewhere else.
  const draw = {};
  const openTurn = await getOpenTurn();
  await prisma.$transaction(async (tx) => {
    const [myResources, roomResources, roomObols, myObols] = await Promise.all([
      readCharacterResources(tx, me.id),
      readRoomResources(tx, hideout.id),
      obolTag
        ? tx.roomTag.findFirst({ where: { roomId: hideout.id, tagId: obolTag.id }, select: { quantity: true } })
        : null,
      obolTag
        ? tx.characterTag.findUnique({
            where: { characterId_tagId: { characterId: me.id, tagId: obolTag.id } },
            select: { quantity: true },
          })
        : null,
    ]);
    const pools = {
      "room:resources": roomResources,
      "room:obols": roomObols?.quantity ?? 0,
      "self:resources": myResources,
      "self:obols": myObols?.quantity ?? 0,
    };
    let owed = total;
    for (const key of order) {
      if (owed <= 0) break;
      const take = Math.min(owed, pools[key]);
      if (take <= 0) continue;
      draw[key] = take;
      owed -= take;
    }
    if (owed > 0) throw new UserError("Not enough there.");

    // Every leg below is booked, and each one by hand, because none of them
    // goes through a hooked primitive: the two balance legs are guarded
    // conditional decrements (the concurrency shape has to stay, so the ledger
    // row comes to them) and the own-obols leg goes through spendCharacterTag
    // rather than dropCharacterTag for the same reason. Unbooked, a cult
    // purchase drifted both the hideout and the buyer permanently.
    //
    // `secret` throughout: a cult purchase is exactly what the redaction flag
    // is for. The amount still counts toward every aggregate; only the
    // counterparty is withheld from a plain GM.
    const econ = { reason: "THANATI", secret: true, ...turnStamp(openTurn) };
    const roomParty = { kind: "room", id: hideout.id, name: hideout.name };
    const selfParty = { kind: "character", id: me.id, name: me.name };

    for (const [key, amount] of Object.entries(draw)) {
      if (key === "room:resources") {
        // Strict, not clamped: takeRoomResources takes the whole amount or
        // nothing and says which, which is the same conditional-write check
        // the old `where: { resources: { gte: amount } }` was.
        if (!(await takeRoomResources(tx, hideout.id, amount))) throw new UserError("Not enough there.");
        await record(tx, { from: roomParty, to: BURN, form: "BALANCE", amount }, econ);
      } else if (key === "self:resources") {
        if (!(await takeCharacterResources(tx, me.id, amount))) throw new UserError("Not enough there.");
        await record(tx, { from: selfParty, to: BURN, form: "BALANCE", amount }, econ);
      } else if (key === "room:obols") {
        // `.ok` — dropRoomTag returns an object, so testing the call is always truthy.
        if (!obolTag || !(await dropRoomTag(tx, hideout.id, obolTag.id, amount, { econ })).ok) {
          throw new UserError("Not enough there.");
        }
      } else if (!obolTag || !(await spendCharacterTag(tx, me.id, obolTag.id, amount))) {
        throw new UserError("Not enough there.");
      } else {
        await record(
          tx,
          { from: selfParty, to: BURN, form: "COIN", amount, tag: { id: obolTag.id, slug: "obol" }, quantity: amount, unitValue: 1 },
          econ,
        );
      }
    }
    for (const line of lines) await addToRoomStack(tx, hideout.id, line.tagId, line.quantity);
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "thanati_purchase",
      targetCharacterId: me.id,
      details: {
        room: hideout.name,
        roomId: hideout.id,
        total,
        paid: draw,
        preferred: { currency: currencyFirst, purse: purseFirst },
        lines: lines.map((l) => ({ name: l.name, quantity: l.quantity, each: l.each })),
      },
    });
  });

  // The room's ordinary stash line, the one Transfer already posts.
  after(() => announceInRoom(hideout, me, `leaves ${formatGoods(lines)} here.`));
  revalidate();
  return { ok: true, total };
}

export async function recallComrades() {
  return guarded(() => recallComradesImpl());
}
export async function recoverEquipment() {
  return guarded(() => recoverEquipmentImpl());
}
export async function setHideout(input) {
  return guarded(() => setHideoutImpl(input ?? {}));
}
export async function purchaseGear(input) {
  return guarded(() => purchaseGearImpl(input ?? {}));
}
