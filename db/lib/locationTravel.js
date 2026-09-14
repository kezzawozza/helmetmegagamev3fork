// The database half of ANY player-driven location change — the #turns Travel
// button and /location (bot) both come through here; the web app's writers
// (creation, GM teleport, Bulk Move) are raw relocations and do not. It validates the hop, enforces the same-zone cooldown or files the
// Move a zone crossing costs, walks the mover's escort party along, and performs **no
// Discord side effects**: the caller runs
// db/lib/locationMove.js#applyLocationMoveSideEffects over `moved`.
//
// EVERY crossing lands at once, paid or free. A crossing that cost the Move
// used to park its destination and wait for a turn advance to walk the party
// over — a day on the road, which kept the destination's channels shut until
// then. It doesn't any more (MAP.md §3): the Move is still spent, and you
// are there.
//
// Deliberately NOT on the @lifeweb/db barrel; require it by path.
const { recordArchiveEvent } = require("./archive");
const { seatZoneIdFor } = require("./seatZone");
const { rollCavingOnArrival, cavingHoldFor, cavingHeldIds } = require("./cavingPass");
const { INCAPACITATING_SLUGS, blockerFor, ACT } = require("./incapacitation");
const { OVERBURDENED_SLUG } = require("./constants");
const { isMounted, isBoated, blocksOnFoot, boatCrossing, equippedSlugs, fastTravelCapacity, fastTravelBonus, STOWABLE_SLUGS } = require("./mounts");
const { partyOf, escortAuthority, ESCORT_SELECT } = require("./escort");
const { heldReasonFor, fireWatches, NOT_A_FIGHT } = require("./intercept");
const { linkBetween, crossingCheck } = require("./locationGraph");
const { dismountForNarrowWay } = require("./indoors");
const { MOTION_SICKNESS_SLUG, VOMITING_SLUG } = require("./constants");
const { expiryForGrant } = require("./grantExpiry");
const { addToStack } = require("./tagWrites");
const { sendDm } = require("./dm");

// Too hurt, or too dazed, to make a whole zone's walk for free. Three are
// legs — a Peg Leg is absent on purpose, Bascinet's call, a wooden leg still
// walks — and Pain Shock joins them for the other reason: not injured enough
// to stop you, just too out of it to find your own way anywhere. An equipped
// mount cancels every one of these, because the horse is doing the walking
// (or, for Pain Shock, the finding).
const LAMED_SLUGS = new Set(["crippled-leg", "missing-leg", "sprained-ankle", "pain-shock", "cripple"]);

const CHARACTER_SELECT = {
  id: true,
  name: true,
  status: true,
  discordUserId: true,
  locationId: true,
  zoneId: true,
  factionId: true,
  isLeader: true,
  buriedAt: true,
  zoneMovesTurnId: true,
  zoneMovesUsed: true,
  zoneMovesBonusUsed: true,
  // The hold. One timestamp, read by heldReasonFor() at the top of
  // performLocationMove and again per follower (INTERCEPT.md), and the word
  // for WHICH thing has hold of them — a select carrying one without the
  // other tells an attacked player they were ambushed (ATTACK.md §1).
  heldUntil: true,
  heldReason: true,
  // `name` rides along for stowedMounts(), which puts it in a sentence.
  tags: { select: { equipped: true, tag: { select: { slug: true, name: true } } } },
};

// How many zone crossings this character gets for free this turn, before a
// crossing starts spending their Move (docs/systemdocs/CARRY.md §2).
//
// Everyone gets GameConfig.freeZoneMovesPerTurn. An EQUIPPED mount adds one,
// and it now refreshes every turn rather than once a day — a horse carries you
// at Dawn and again at Dusk. Being Overburdened takes the lot: that is the
// cost that replaced the old flat refusal, so an overloaded character can
// still cross, they just pay their Move to do it. A ruined leg takes it too,
// unless a horse is doing the walking.
//
// The mount's crossing is spent BEFORE the base one (moveAllowance below
// returns the two pools separately, and Character.zoneMovesBonusUsed
// remembers which was charged). Otherwise a rider who stables their horse at
// an indoors door loses a crossing they still had: the allowance is
// recomputed every time, so the horse's move would vanish and the base one
// would already be spent.

// How many are LEFT right now, for the surfaces that have to say so before a
// player commits: the Travel confirm and the character sheet.
//
// `crossing` is the same optional `{ fromZoneSlug, toZoneSlug }` moveAllowance
// takes, and for the same reason: a caller with a specific destination in
// hand (the Travel panel and /map, once a node is picked) has to pass it, or
// a boat's bonus — earned per crossing, never banked — silently disappears
// from the very surfaces that are supposed to tell a player it applies. A
// caller with no destination yet (the sheet's ambient count) passes nothing,
// same as freeZoneMoves, and gets the honest pre-commitment number.
function freeMovesLeft(character, config, openTurn, partySize = 0, crossing = null) {
  return movesLeft(moveAllowance(character, config, crossing, partySize), character, openTurn);
}

// The arithmetic both the display above and the spend below run: base and
// bonus are counted SEPARATELY, because a bonus that goes away mid-turn must
// not take a base crossing with it. Whatever was charged to a bonus stays
// charged to it, so a horse parked at an indoors door leaves the rider the
// crossing they never spent.
function movesLeft({ base, bonus }, character, openTurn) {
  if (!openTurn) return base + bonus;
  const sameTurn = character?.zoneMovesTurnId === openTurn.id;
  const spent = sameTurn ? (character.zoneMovesUsed ?? 0) : 0;
  const bonusSpent = sameTurn ? (character.zoneMovesBonusUsed ?? 0) : 0;
  const baseSpent = Math.max(0, spent - bonusSpent);
  return Math.max(0, base - baseSpent) + Math.max(0, bonus - bonusSpent);
}

// What undoing a Move should also undo on the Character row — what a zone
// crossing spends OUTSIDE Action.appliedEffects entirely, because
// performLocationMove writes it straight onto Character instead of
// snapshotting it on the Action: EVERY crossing this turn, free or paid,
// claims against zoneMovesUsed/zoneMovesTurnId. Deleting the Action alone
// left the day's free crossings spent even though the Move that (over-)spent
// them just came back.
//
// WHAT IT NO LONGER UNDOES IS THE CROSSING ITSELF. A paid crossing used to
// stamp a travel pointer rather than move anybody, so undoing the Action
// really did call the journey off. Travel lands at once now (MAP.md §3) —
// the character is already standing at the destination, and handing their
// Move back does not walk them home. A GM who wants that teleports them.
//
// Pure on purpose — web/lib/moveEconomy.js#deleteActionRestoringTurn is the
// only caller and applies whatever this returns, but keeping the decision
// separate from the write is what makes it testable without a database.
//
// `action` needs { turnId, characterId, character: { zoneMovesTurnId,
// zoneMovesUsed, zoneMovesBonusUsed } }. Returns a Character update object,
// or null when this Action never claimed a crossing. zoneMovesBonusUsed
// resets alongside zoneMovesUsed — a claim undone this turn owes back
// whatever pool it was charged to, mount bonus included, not just the flat
// count.
//
// Action.turnId is unique per character (@@unique([characterId, turnId])),
// so a match against it can only ever mean THIS Action — there is no other
// Action this turn it could belong to instead.
function travelClaimsToUndo(action) {
  const character = action?.character;
  if (!character) return null;
  const data = {};
  if (character.zoneMovesTurnId === action.turnId) {
    data.zoneMovesUsed = 0;
    data.zoneMovesBonusUsed = 0;
    data.zoneMovesTurnId = null;
  }
  return Object.keys(data).length ? data : null;
}

// Motion Sickness can't be equipped onto a mount or a boat (that gate lives
// in web/app/(app)/character/equipActions.js) — so the only way it ever rides
// one is being dragged along by someone else's. Best-effort and swallows its
// own errors: a DM or a tag write going wrong should never break the move
// itself. Fires once per zone crossing that way, and does nothing if the
// character already holds vomiting.
async function vomitOnTheRide(prisma, row, openTurn) {
  try {
    const already = row.tags?.some((ct) => ct.tag.slug === VOMITING_SLUG);
    if (already) return;
    const tag = await prisma.tag.findUnique({
      where: { slug: VOMITING_SLUG },
      select: { id: true, defaultDurationTurns: true },
    });
    if (!tag) return;
    const expiresTurn = await expiryForGrant(prisma, tag, openTurn);
    await addToStack(prisma, row.id, tag.id, 1, { source: "EVENT", expiresTurn });
    if (row.discordUserId) {
      await sendDm(prisma, row.discordUserId, "The ride makes you sick. You're **Vomiting**.");
    }
  } catch (err) {
    console.error("vomitOnTheRide failed:", err);
  }
}

// `crossing` is optional: `{ fromZoneSlug, toZoneSlug }` when the caller knows
// where this character is actually going. Only the boat needs it — its extra
// move is earned per crossing rather than banked per turn — so every caller
// that is merely displaying an allowance passes nothing and is unaffected.
function freeZoneMoves(character, config, crossing = null, partySize = 0) {
  const { base, bonus } = moveAllowance(character, config, crossing, partySize);
  return base + bonus;
}

// The same rules, split into the two pools that are now spent in order. The
// BONUS pool is whatever a mount or a boat is buying for this crossing; the
// BASE pool is the flat per-turn allowance everybody gets.
function moveAllowance(character, config, crossing = null, partySize = 0) {
  const held = character.tags ?? [];
  if (held.some((ct) => ct.tag?.slug === OVERBURDENED_SLUG)) return { base: 0, bonus: 0 };
  const base = config?.freeZoneMovesPerTurn ?? 1;
  const active = equippedSlugs(held);
  // A horse carries you whatever your legs are, so it is checked FIRST and
  // cancels lameness outright rather than adding one to a zero.
  //
  // But only while the party FITS it. fastTravelCapacity counts the rider, so
  // a horse seats the rider and one more, and a cart upgrades that pair to
  // six (db/lib/mounts.js). There is no cap on how many people you take —
  // going over simply costs you the mount's extra crossing, and that is the
  // whole price of overloading. On foot the capacity is 0 and there is no
  // bonus to lose, so walking any number of people is free; an overloaded
  // horse is therefore never WORSE than legs, only no better.
  if (isMounted(active)) {
    return { base, bonus: fitsMount(active, partySize) ? fastTravelBonus(active) : 0 };
  }
  // A boat does the same, but only where the water goes. It does NOT cancel
  // lameness: you still have to get down to the bank.
  const onWater = isBoated(active) && boatCrossing(crossing?.fromZoneSlug, crossing?.toZoneSlug);
  if (held.some((ct) => LAMED_SLUGS.has(ct.tag?.slug))) return { base: 0, bonus: 0 };
  return { base, bonus: onWater ? 1 : 0 };
}

// Whether the mover and their party fit the seats their mount actually has.
// Split out because three surfaces ask it: the allowance above, the hover
// below, and the panel that draws the dashed cards. A capacity of 0 is
// somebody on foot, who has no seats to overfill.
function fitsMount(activeSlugs, partySize = 0) {
  const seats = fastTravelCapacity(activeSlugs);
  if (seats <= 0) return true;
  return partySize + 1 <= seats;
}

// One sentence explaining the sheet's crossing count, for its hover. Usually
// that means why the number is 0 — a bare 0 leaves a lamed or overloaded player
// with nothing to act on. It also covers the opposite case: a boat's extra
// crossing is earned per crossing, not banked, so the number UNDERSTATES what a
// boatman gets on the water and has to say so.
function freeZoneMovesReason(character, partySize = 0) {
  const held = character.tags ?? [];
  if (held.some((ct) => ct.tag?.slug === OVERBURDENED_SLUG)) {
    return "Overburdened: you don't have a free move anymore.";
  }
  const active = equippedSlugs(held);
  if (isMounted(active)) {
    // The one case where the number is lower than a player expects for a
    // reason they cannot read off their own sheet.
    if (!fitsMount(active, partySize)) {
      return `You're taking more people than your ${fastTravelCapacity(active)} seats, so you've lost the free move.`;
    }
    return null;
  }
  const lamed = held.find((ct) => LAMED_SLUGS.has(ct.tag?.slug));
  if (lamed) return `${lamed.tag.name}: you can't cross a zone for free without riding.`;
  // Not a refusal — the number above is right for most crossings, and the
  // boat quietly adds one to the three that touch water.
  if (isBoated(equippedSlugs(held))) {
    return "Your boat gives you a free crossing between the Forest, the Black Hills and the Marshes.";
  }
  return null;
}

// WHO FOLLOWS YOU is no longer decided here. db/lib/escort.js owns it — one
// authority for a party you attach once, instead of the two predicates that
// used to say the same thing (canDrag, and the MOVE_CHARACTER request's own
// inline copy). This module only walks whoever is already attached.

class MoveRefused extends Error {
  constructor(reason, extra = {}) {
    super(reason);
    this.refused = true;
    Object.assign(this, extra);
  }
}

// `character` is the mover as loaded by the caller (needs id, name,
// locationId, zoneId, factionId, isLeader, discordUserId, tags);
// `targetLocation` must include its zone.
//
// WHO COMES ALONG is not a parameter any more. The party is read off
// Character.escortedById inside this function's own transaction, so a client
// cannot post a list of ids at all — which deletes the whole class of
// re-authorising a picker's output that the old `dragged` argument needed.
async function performLocationMove(prisma, character, targetLocation) {
  if (!targetLocation?.zone) throw new Error("performLocationMove needs targetLocation.zone");

  // The MOVER's own state. Escorting asks whether the TARGET is helpless;
  // the answer to "can this character walk at all" was simply never asked
  // before this gate existed, so a bound,
  // paralyzed or unconscious character could stroll out of the room they were
  // being held in.
  //
  // Every crossing in the game funnels through here (db/lib/locationGraph.js),
  // so this one gate covers the bot's picker, the /location command and the
  // staged push alike.
  const stuck = blockerFor(character.tags, ACT);
  if (stuck) return { ok: false, reason: `You can't go anywhere — you're ${stuck.name}.` };

  // Somebody laid in wait and stopped them (docs/systemdocs/INTERCEPT.md).
  // Beside the ACT gate rather than inside it because a hold takes MOVEMENT
  // and nothing else — held, you can still act, speak and fight back. One
  // comparison against a timestamp, and it lapses on its own.
  const held = heldReasonFor(character);
  if (held) return { ok: false, reason: held };

  let currentLocation = null;
  let crossingLink = null;
  if (character.locationId) {
    if (character.locationId === targetLocation.id) {
      return { ok: false, reason: "You're already there." };
    }
    currentLocation = await prisma.location.findUnique({
      where: { id: character.locationId },
      include: { zone: true },
    });
    if (!currentLocation) {
      return { ok: false, reason: "You can't get there directly from here." };
    }

    // The edge, and what it lets this character do. A missing edge, a hidden
    // one they hold no key to, a locked one and a shut modular gate all
    // refuse here — the picker filters the same verdict, but a client can
    // post any location id it likes, so this is the check that counts.
    crossingLink = await linkBetween(prisma, currentLocation.id, targetLocation.id);
    const gate = crossingCheck(crossingLink, {
      tagSlugs: (character.tags ?? []).map((ct) => ct.tag?.slug).filter(Boolean),
      // Equipped, not merely held — CHARACTER_SELECT already loads `equipped`
      // for exactly this kind of question.
      onFootBlocked: blocksOnFoot(equippedSlugs(character.tags ?? [])),
    });
    if (!gate.passable) return { ok: false, reason: gate.refusal };
  }

  // A first placement (no current location) is free — it isn't travel, it's
  // arrival. A walk inside the zone is free on the cooldown. Only a hop
  // whose edge crosses into another zone files the Move.
  const first = !currentLocation;
  const crossedZone = !first && currentLocation.zoneId !== targetLocation.zoneId;

  let openTurn = null;
  if (crossedZone) {
    // An unresolved 1 on the Caving Die pins them where it happened until a GM
    // has adjudicated it (docs/systemdocs/CAVING.md §2c). Inside this branch
    // and not beside the heldReasonFor gate above, because this one takes the
    // way OUT of the zone and nothing else — walking the level is still free,
    // which is also what lets a party regroup while they wait.
    const cavingHold = await cavingHoldFor(prisma, character.id, currentLocation.zoneId);
    if (cavingHold) return { ok: false, reason: cavingHold };

    openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
    if (!openTurn) return { ok: false, reason: "No turn is currently open." };
  }
  const config = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: {
      locationMoveCooldownSeconds: true,
      archiveTravelEvents: true,
      freeZoneMovesPerTurn: true,
    },
  });
  const cooldownMs = Math.max(0, config?.locationMoveCooldownSeconds ?? 60) * 1000;

  const now = new Date();
  const outcome = {
    spentTurn: false,
    usedFreeMove: false,
    freeMovesLeft: null,
    partyRows: [],
    // Followers the edge would not take. They are detached and left standing
    // rather than failing the whole move (MAP.md §3a); the caller DMs them
    // and their leader off this list.
    leftBehind: [],
    // Mounts a too-narrow way made them leave behind — see the dismount step
    // at the top of the transaction below.
    dismounted: [],
  };

  // The party, read BEFORE the transaction so the free-move arithmetic below
  // knows how many seats are in use. Re-read inside it, where it counts.
  const partyPreview = await partyOf(prisma, character.id);

  // The edge everybody is crossing, read once out here rather than per
  // follower inside the transaction. Null on a first placement, which has no
  // edge to check.
  const followerLink = currentLocation ? await linkBetween(prisma, currentLocation.id, targetLocation.id) : null;

  try {
    await prisma.$transaction(async (tx) => {
      // A way too narrow for what they had out dismounts them instead of
      // refusing outright (db/lib/indoors.js#dismountForNarrowWay) — but it
      // has to happen HERE, first, inside this same transaction, rather than
      // as a post-commit side effect the way arriving indoors is. Arriving
      // indoors only affects the NEXT crossing; this one affects the free-move
      // accounting for THIS one. A mount buys an extra free zone crossing
      // (freeZoneMoves below), so dismounting after the fact would let a rider
      // bank that bonus on a ride that never survives the threshold — exactly
      // the exploit refusing at the threshold used to exist to close
      // (docs/systemdocs/MAP.md §2c). Mutating `character.tags` in memory is
      // what makes freeZoneMoves see the dismount too, with no extra query.
      outcome.dismounted = await dismountForNarrowWay(tx, character.id, crossingLink);
      if (outcome.dismounted.length > 0) {
        character.tags = (character.tags ?? []).map((ct) =>
          STOWABLE_SLUGS.has(ct.tag?.slug) ? { ...ct, equipped: false } : ct,
        );
      }

      // The party is re-loaded and re-authorized INSIDE the transaction, and
      // this copy is the one that counts — everything above it is a preview.
      //
      // Two things drop a follower here, and NEITHER refuses the move. That
      // is the change from dragging, where one bad passenger threw the whole
      // hop away: somebody who wandered off, or somebody the edge itself will
      // not take. They are let go and left standing, and the caller tells
      // them both.
      const party = await partyOf(prisma, character.id, { tx });
      if (party.length > 0) {
        const mover = await tx.character.findUnique({ where: { id: character.id }, select: ESCORT_SELECT });
        // Which of them the Caving Die has hold of. One query for the whole
        // party rather than one per follower, and only on a crossing, since
        // that is the only thing the hold takes.
        const cavingHeld = crossedZone
          ? await cavingHeldIds(tx, party.map((row) => row.id), currentLocation.zoneId)
          : new Set();
        const coming = [];
        for (const row of party) {
          // Held where they stand. A follower is walked by an updateMany and
          // never comes past the mover's own gate, so without this line a
          // friend could carry somebody straight out of an ambush.
          //
          // ABOVE escortAuthority on purpose, even though that refuses a held
          // character too. Its refusal is a bare null, which reads here as
          // "gone" — and "held" is the ONE leftBehind reason the leader is
          // told out loud, because somebody having hold of your friend is
          // plain to see. Ordered the other way, they never hear it.
          if (heldReasonFor(row)) {
            outcome.leftBehind.push({ row, reason: "held" });
            continue;
          }
          // The Die has hold of them, same shape and the same reason: a
          // follower never comes past the mover's own gate, so without this
          // line a friend carries the caver out of their own unadjudicated
          // encounter. Its own reason rather than "held", which is the
          // intercept's word and buys a line of copy this does not need — an
          // unknown reason falls through to the plain "couldn't follow"
          // everywhere it is read.
          if (cavingHeld.has(row.id)) {
            outcome.leftBehind.push({ row, reason: "caving" });
            continue;
          }
          if (!escortAuthority(mover, row)) {
            outcome.leftBehind.push({ row, reason: "gone" });
            continue;
          }
          // The edge, judged against the FOLLOWER's own tags and their own
          // mount — not the leader's. A crawl the leader has the Caving for
          // is still a crawl their unskilled companion cannot follow them
          // down, and a rider cannot be led through an onFoot gap.
          if (currentLocation) {
            const gate = crossingCheck(followerLink, {
              tagSlugs: (row.tags ?? []).map((ct) => ct.tag?.slug).filter(Boolean),
              onFootBlocked: blocksOnFoot(equippedSlugs(row.tags ?? [])),
            });
            if (!gate.passable) {
              outcome.leftBehind.push({ row, reason: "edge" });
              continue;
            }
          }
          coming.push(row);
        }
        if (outcome.leftBehind.length > 0) {
          await tx.character.updateMany({
            where: { id: { in: outcome.leftBehind.map((e) => e.row.id) } },
            data: { escortedById: null },
          });
        }
        outcome.partyRows = coming;
      }

      if (crossedZone) {
        // A crossing spends a FREE ZONE MOVE first, and only when those run
        // out does it spend the Move (docs/systemdocs/CARRY.md §2). So a
        // peasant walks town -> forest for nothing, then pays their Move to
        // reach the fortress, and the way back waits for the next turn.
        //
        // The allowance is claimed by a conditional updateMany whose WHERE is
        // the check, so two tabs cannot both spend the last one. A turn id
        // that differs from the stored one resets the counter in the same
        // statement, which is why nothing ever has to sweep this field.
        // partyPreview, not the re-authorized list: the seats are spent on
        // who you SET OUT with. Somebody the gate drops at the threshold has
        // already taken up a saddle for this crossing.
        const allowance = moveAllowance(
          character,
          config,
          { fromZoneSlug: currentLocation.zone?.slug, toZoneSlug: targetLocation.zone?.slug },
          partyPreview.length,
        );
        const sameTurn = character.zoneMovesTurnId === openTurn.id;
        const spentFree = sameTurn ? (character.zoneMovesUsed ?? 0) : 0;
        const spentBonus = sameTurn ? (character.zoneMovesBonusUsed ?? 0) : 0;
        const left = movesLeft(allowance, character, openTurn);
        // The bonus pool goes first. A crossing charged to it stays charged to
        // it for the rest of the turn, so parking the horse indoors afterwards
        // gives back nothing and takes back nothing.
        const onBonus = allowance.bonus > spentBonus;

        if (left > 0) {
          const claimed = await tx.character.updateMany({
            where:
              character.zoneMovesTurnId === openTurn.id
                ? { id: character.id, zoneMovesTurnId: openTurn.id, zoneMovesUsed: spentFree }
                : {
                    id: character.id,
                    // `{ not: x }` never matches NULL in SQL, so the null case
                    // has to be spelled out or a character who has not moved
                    // this turn could never claim their first free move.
                    OR: [{ zoneMovesTurnId: null }, { zoneMovesTurnId: { not: openTurn.id } }],
                  },
            data: {
              zoneMovesTurnId: openTurn.id,
              zoneMovesUsed: spentFree + 1,
              zoneMovesBonusUsed: onBonus ? spentBonus + 1 : spentBonus,
            },
          });
          if (claimed.count === 0) throw new MoveRefused("You've already moved. Try again in a moment.");
          outcome.usedFreeMove = true;
          outcome.freeMovesLeft = left - 1;
        } else {
          // Out of free moves, so this costs the Move. Acting and crossing are
          // mutually exclusive within a turn, in either order;
          // @@unique([characterId, turnId]) is the real enforcement and the
          // read here is for the message.
          const existing = await tx.action.findFirst({
            where: { characterId: character.id, turnId: openTurn.id },
            select: { id: true },
          });
          if (existing) {
            throw new MoveRefused(
              allowance.base + allowance.bonus === 0
                ? "You're overburdened, so you have no free moves left."
                : "You're out of free moves this turn and you've already acted.",
            );
          }
          await tx.action.create({
            data: {
              characterId: character.id,
              turnId: openTurn.id,
              type: "MOVE",
              status: "CONFIRMED",
              moveReviewStatus: "SOLVED",
              description: `Travelled to ${targetLocation.name} (${targetLocation.zone.name}).`,
              // The SEAT zone, not the presence zone — a Move filed from the
              // Railroad belongs on the Caves GM's table.
              zoneId: seatZoneIdFor(targetLocation.zone),
              resultMessage: `» Travelled to ${targetLocation.name}.`,
              gmNotes: "auto:zone_change",
            },
          });
          outcome.spentTurn = true;
        }
        outcome.freeMovesLeft ??= 0;
        // Paid or free, the crossing lands NOW. A paid one used to park its
        // destination and wait for the turn advance to walk the traveller
        // over; it doesn't any more (MAP.md §3), so the two branches are one
        // write.
        await tx.character.update({
          where: { id: character.id },
          data: {
            locationId: targetLocation.id,
            zoneId: targetLocation.zoneId,
            lastLocationMoveAt: now,
            // Walking under your own power is how a willing follower leaves
            // (MAP.md §3a). A helpless one never reaches this line.
            escortedById: null,
          },
        });
      } else {
        // Same zone (or first placement): the cooldown, enforced by the
        // WHERE of a conditional update so two clicks in one tick can't both
        // pass.
        const cutoff = new Date(now.getTime() - cooldownMs);
        const claimed = await tx.character.updateMany({
          where: {
            id: character.id,
            OR: [{ lastLocationMoveAt: null }, { lastLocationMoveAt: { lte: cutoff } }],
          },
          data: {
            locationId: targetLocation.id,
            zoneId: targetLocation.zoneId,
            lastLocationMoveAt: now,
            escortedById: null,
          },
        });
        if (claimed.count === 0) {
          const row = await tx.character.findUnique({
            where: { id: character.id },
            select: { lastLocationMoveAt: true },
          });
          const readyAt = (row?.lastLocationMoveAt?.getTime() ?? 0) + cooldownMs;
          const seconds = Math.max(1, Math.ceil((readyAt - now.getTime()) / 1000));
          throw new MoveRefused(`You're still catching your breath — ${seconds}s.`, { retryAfterSeconds: seconds });
        }
      }

      // Walking off releases anybody this character was holding. A hold is a
      // hand on a shoulder (INTERCEPT.md); you cannot keep one from the next
      // zone. One of the three writers that ends a hold early — the other two
      // are the holder's own Release and their death.
      //
      // A FIGHT is not this clear's to end, the releaseHeldBy rule: heldById
      // names one opponent and a brawl has several, so a blind clear would
      // free somebody out of a fight that is still going. A held character
      // cannot walk anyway, so this never has a fight in front of it — the
      // guard is here because the day it does, it must not fire.
      // db/lib/attack.js#closeFightsFor is the writer for that, off every
      // relocation (db/lib/locationMove.js).
      await tx.character.updateMany({
        where: { heldById: character.id, heldUntil: { gt: now }, ...NOT_A_FIGHT },
        data: { heldUntil: null, heldById: null, heldReason: null },
      });

      if (outcome.partyRows.length > 0 || outcome.leftBehind.length > 0) {
        // The party lands with the mover, whether or not the crossing cost a
        // Move — one statement for all of them, and no Action, cooldown claim
        // or mount claim of their own (MAP.md §3a).
        await tx.character.updateMany({
          where: { id: { in: outcome.partyRows.map((t) => t.id) } },
          data: { locationId: targetLocation.id, zoneId: targetLocation.zoneId, lastLocationMoveAt: now },
        });
        await tx.auditLog.create({
          data: {
            actorDiscordUserId: character.discordUserId ?? null,
            actionType: "characters_escorted",
            targetCharacterId: character.id,
            details: {
              mover: character.name,
              to: targetLocation.name,
              zone: targetLocation.zone.name,
              party: outcome.partyRows.map((t) => ({ id: t.id, name: t.name })),
              leftBehind: outcome.leftBehind.map((e) => ({ id: e.row.id, name: e.row.name, why: e.reason })),
            },
          },
        });
      }
    });
  } catch (err) {
    if (err?.refused) return { ok: false, reason: err.message, retryAfterSeconds: err.retryAfterSeconds };
    if (err?.code === "P2002") return { ok: false, reason: "You've already acted this turn." };
    throw err;
  }

  // Off by default (see GameConfig.archiveTravelEvents), and only for a
  // zone crossing — a row per cooldown step would be exactly the volume the
  // gate exists to prevent.
  if (config?.archiveTravelEvents && crossedZone) {
    await recordArchiveEvent(prisma, {
      kind: "TRAVEL",
      character,
      zoneId: targetLocation.zoneId,
      zoneName: targetLocation.zone.name,
      content: `${character.name} left ${currentLocation.zone.name} for ${targetLocation.zone.name}.`,
    });
  }

  // Whether ANY leg of this move was a free ride, for the Motion Sickness
  // check below — a dragged passenger who has no mount of their own still
  // gets sick if the one dragging them does.
  const ridden =
    crossedZone &&
    (isMounted(equippedSlugs(character.tags ?? [])) || isBoated(equippedSlugs(character.tags ?? [])));

  const moved = [];
  for (const row of [character, ...outcome.partyRows]) {
    const fromLocationId = row.id === character.id ? currentLocation?.id ?? null : row.locationId;
    const fromZoneId = row.id === character.id ? currentLocation?.zoneId ?? null : row.zoneId;
    // The Caving Die, which is now the only thing arrival does. Null on a
    // surface Location and on a SAFE one; kind, open turn and error swallowing
    // all live in the helper. Walking back somewhere you already saw today
    // rolls again — there is no per-Location cap any more (CAVING.md 2b).
    const cavingDm = await rollCavingOnArrival(prisma, row, targetLocation);
    if (ridden && row.id !== character.id && row.status === "ALIVE") {
      const carsick = row.tags?.some((ct) => ct.tag.slug === MOTION_SICKNESS_SLUG);
      if (carsick) {
        await vomitOnTheRide(prisma, row, openTurn);
      }
    }
    moved.push({
      character: { id: row.id, name: row.name, discordUserId: row.discordUserId, status: row.status },
      fromLocationId,
      fromZoneId,
      toLocationId: targetLocation.id,
      toZoneId: targetLocation.zoneId,
      zoneChanged: fromZoneId !== targetLocation.zoneId,
      cavingDm,
    });
  }

  // Anybody laying in wait here (docs/systemdocs/INTERCEPT.md). Hooked HERE
  // rather than on applyLocationMoveSideEffects — which is the writer every
  // relocation runs — because an intercept is one person acting on another
  // and the fiction is being stopped ON THE ROAD. Coming down the road is the
  // gate: a GM's teleport, a Bulk Move, a staged Relocate to, a rite and a
  // character's first placement must not trip somebody's ambush.
  //
  // The whole party goes in at once, mover first, which is what makes "if
  // several people come up together they all get stopped" free. It sends
  // nothing; the caller sends `interceptDms` the way it already sends
  // `cavingDm`, after this returns and outside any transaction.
  let interceptDms = [];
  if (moved.length > 0) {
    const turnForWatches = openTurn ?? (await prisma.turn.findFirst({ where: { status: "OPEN" } }));
    // Wrapped: a watch that throws must never wedge a move that has already
    // committed. The mover is standing at the destination either way.
    try {
      ({ dms: interceptDms } = await fireWatches(prisma, {
        arrivals: moved.map((entry) => entry.character),
        locationId: targetLocation.id,
        openTurn: turnForWatches,
      }));
    } catch (err) {
      console.error(`Intercept: firing watches at ${targetLocation.id} failed:`, err.message ?? err);
    }
  }

  return {
    ok: true,
    interceptDms,
    oldLocation: currentLocation,
    oldZone: currentLocation?.zone ?? null,
    targetLocation,
    targetZone: targetLocation.zone,
    crossedZone,
    spentTurn: outcome.spentTurn,
    usedFreeMove: outcome.usedFreeMove,
    dismounted: outcome.dismounted,
    // Followers the way would not take. Detached and still standing where
    // they were; the caller owes them and their leader a line. The reason
    // is deliberately NOT the edge's own refusal — "the way is locked" on a
    // hidden crawl would announce that the crawl is there (MAP.md §2a).
    leftBehind: outcome.leftBehind.map((e) => ({
      character: { id: e.row.id, name: e.row.name, discordUserId: e.row.discordUserId, status: e.row.status },
      reason: e.reason,
    })),
    freeMovesLeft: outcome.freeMovesLeft,
    moved,
  };
}

module.exports = {
  performLocationMove,
  freeZoneMoves,
  freeMovesLeft,
  freeZoneMovesReason,
  travelClaimsToUndo,
  fitsMount,
  CHARACTER_SELECT,
};
