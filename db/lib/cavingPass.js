// The Caving Die — see docs/systemdocs/CAVING.md.
//
// WALKING is what wakes the dark. There is one trigger — rollCavingOnArrival(),
// fired by every path that lands a character on a Location in a CAVE_LEVEL
// zone, going deeper or retreating alike. Standing still costs nothing: the
// old turn-start pass is gone, because it punished the one thing a cave should
// reward, which is not moving.
//
// EVERY arrival rolls, first visit or fifth. There used to be a cap of one
// roll per Location per turn, enforced by a @@unique on the CavingRoll row and
// read here as a swallowed P2002 — so a caver who pushed four rooms into the
// Depths walked the whole way back out in silence, which read as a broken die
// rather than a rule. Nothing caps it now: the walk cooldown
// (GameConfig.locationMoveCooldownSeconds) is the only brake on how often
// somebody can pace between two rooms and pay for it.

// Takes `prisma` as a parameter — see db/lib/dm.js for why.
const { drawLoot } = require("./cavingLoot");
const { hasAttribute, SAFE_ATTRIBUTE } = require("./locationAttributes");
const { addToStack, clampEquippedQuantity } = require("./tagWrites");
const { applyMood } = require("./mood");
const { rollWithAdvantage } = require("./advantage");
const { LUCKY_SLUG } = require("./constants");
const { expiryFrom } = require("./turnFormat");

// Every DM leads with the face, so a player sees their own roll and not just
// its outcome — including QUIET, so nobody wonders whether the die rolled.
function quietDm(die) {
  return `Caving Die: ${die} — Nothing happens.`;
}

function troubleDm(die) {
  return `Caving Die: ${die} — Something is wrong down here. A GM has been notified.`;
}

function luredDm(die) {
  return `Caving Die: ${die} — Something appeared in the darkness, but your lure distracted it.`;
}

function findDm(die, tagName) {
  return `Caving Die: ${die} — You found something: ${tagName}.`;
}

// The single-character primitive. `location` must be a Location row
// ({ id, attributes, zone }) whose zone is a CAVE_LEVEL; the caller is
// responsible for that check. Always writes a row and returns { roll, dm };
// never sends the DM itself.
//
// `trigger` used to be a parameter, back when a turn-start pass shared this
// function. ARRIVAL is the only value anything can write now, so it is written
// here rather than threaded through — but the COLUMN stays, because historic
// rows carry TURN_START.
async function rollCaving(prisma, character, turn, location) {
  const zone = location.zone;
  const trigger = "ARRIVAL";
  // Lucky rolls the Caving Die twice and keeps the better one, which turns
  // the dark from a coin-flip into a prospecting trip. `character` is not
  // guaranteed to arrive with its tags loaded (rollCavingOnArrival is called
  // straight off a move), so the holding is asked for here — the same one-row
  // lookup the Musk Lure below already does rather than trusting the caller.
  const lucky = await prisma.characterTag.findFirst({
    where: { characterId: character.id, tag: { slug: LUCKY_SLUG } },
    select: { id: true },
  });
  const { die } = rollWithAdvantage(lucky ? [{ tag: { slug: LUCKY_SLUG } }] : []);
  const kind = die === 1 ? "TROUBLE" : die === 6 ? "FIND" : "QUIET";

  return await prisma.$transaction(async (tx) => {
    if (kind !== "FIND") {
      // A held Musk Lure eats the first TROUBLE in the holder's place
      // (docs/tags.yaml `musk-lure`): the lure is spent, the row lands
      // QUIET with nothing for the Caving lens to deliberate, and the
      // CAVE_TROUBLE mood hit never fires — whatever it was followed the
      // stink instead. The conditional write is the check, the same
      // no-free-overdraw rule the craft spend uses.
      let lured = false;
      if (kind === "TROUBLE") {
        const lure = await tx.characterTag.findFirst({
          where: { characterId: character.id, tag: { slug: "musk-lure" } },
          select: { id: true, tagId: true, quantity: true },
        });
        if (lure) {
          const spent =
            lure.quantity > 1
              ? await tx.characterTag.updateMany({
                  where: { id: lure.id, quantity: { gte: 1 } },
                  data: { quantity: { decrement: 1 } },
                })
              : await tx.characterTag.deleteMany({ where: { id: lure.id, quantity: 1 } });
          lured = spent.count > 0;
          if (lured) await clampEquippedQuantity(tx, character.id, lure.tagId);
        }
      }
      const rowKind = lured ? "QUIET" : kind;
      const row = await tx.cavingRoll.create({
        data: {
          turnId: turn.id,
          characterId: character.id,
          trigger,
          zoneId: zone.id,
          locationId: location.id,
          die,
          kind: rowKind,
          resolvedAt: rowKind === "QUIET" ? new Date() : null,
        },
      });
      // Something is wrong down here — and the caver knows it (MOOD.md).
      // Teratophobia triples this one.
      if (rowKind === "TROUBLE") await applyMood(tx, character.id, { kind: "CAVE_TROUBLE" });
      return {
        roll: row,
        dm: {
          discordUserId: character.discordUserId,
          content: lured ? luredDm(die) : kind === "TROUBLE" ? troubleDm(die) : quietDm(die),
        },
      };
    }

    // FIND — draw a tier and a tag, grant it, and file the CAVING_LOOT
    // request in the same transaction as the roll and the grant, so a
    // roll can never exist without its loot (or vice versa).
    const { tier, slug } = drawLoot(zone.slug);
    const tag = await tx.tag.findUnique({
      where: { slug },
      select: { id: true, name: true, stackable: true, defaultDurationTurns: true },
    });
    if (!tag) {
      // The catalog is out of sync with cavingLoot.js — refuse to grant a
      // phantom tag. Recorded as TROUBLE-shaped so it still lands on the
      // Caving lens for a GM to notice, rather than vanishing silently.
      console.error(`Caving pass: loot tier "${tier}" drew unknown tag "${slug}" — run npm run db:sync-tags.`);
      const row = await tx.cavingRoll.create({
        data: {
          turnId: turn.id,
          characterId: character.id,
          trigger,
          zoneId: zone.id,
          locationId: location.id,
          die,
          kind: "TROUBLE",
        },
      });
      return {
        roll: row,
        dm: { discordUserId: character.discordUserId, content: troubleDm(die) },
      };
    }

    // `turn.number`, NOT turn.number + 1: unlike hungerPass/tagExpiryPass/
    // moveEffects, `turn` here IS already the first live turn. Nothing in
    // cavingLoot.js's table is timed today; this stamps null either way.
    await addToStack(tx, character.id, tag.id, 1, {
      source: "EVENT",
      stackable: tag.stackable,
      expiresTurn: expiryFrom(turn.number, tag.defaultDurationTurns),
    });

    // The find is recorded on the CavingRoll itself and in the audit log;
    // taking it back lives on the Caving lens (CavingDesk.js), which is the
    // only place a GM ever reached for it.
    await tx.auditLog.create({
      data: {
        actorDiscordUserId: character.discordUserId ?? "system",
        actionType: "caving_loot_granted",
        targetCharacterId: character.id,
        turnId: turn.id,
        details: { tagId: tag.id, tagName: tag.name, added: 1, zoneId: zone.id, tier, die },
      },
    });

    const row = await tx.cavingRoll.create({
      data: {
        turnId: turn.id,
        characterId: character.id,
        trigger,
        zoneId: zone.id,
        locationId: location.id,
        die,
        kind: "FIND",
        lootTier: tier,
        lootTagId: tag.id,
        resolvedAt: new Date(),
      },
    });

    return { roll: row, dm: { discordUserId: character.discordUserId, content: findDm(die, tag.name) } };
  });
}

// The one trigger, for every path that lands a character on a Location —
// player travel, dragging, and raw GM relocations alike. Bails quietly on a
// surface Location, a SAFE one, no open turn, or any error at all: a caving
// roll must never fail the move that caused it. Returns the caller's DM to
// send, or null.
//
// `location` needs { id, attributes, zone: { id, slug, kind } }.
async function rollCavingOnArrival(prisma, character, location) {
  if (location?.zone?.kind !== "CAVE_LEVEL") return null;
  // Customs and the Depot are the cave mouth: a sentry, a floodlight and a
  // shop between them. Nothing stalks a place that busy, and the attribute
  // says so rather than this file naming either slug — see
  // db/lib/locationAttributes.js.
  if (hasAttribute(location, SAFE_ATTRIBUTE)) return null;

  const turn = await prisma.turn.findFirst({ where: { status: "OPEN" } });
  if (!turn) return null;

  try {
    const { dm } = await rollCaving(prisma, character, turn, location);
    return dm;
  } catch (err) {
    console.error(`Caving arrival roll failed for character ${character.id}:`, err);
    return null;
  }
}

// ---- The hold a 1 puts on you --------------------------------------------
//
// A TROUBLE row lands unresolved and waits for a GM. Until this existed the
// caver did not wait with it — they walked out of the caves and a GM ended up
// adjudicating a monster in the dark for somebody standing in Town.
//
// Unlike heldReasonFor (db/lib/intercept.js) this is a QUERY rather than a
// pure comparison, because the answer lives in CavingRoll and nowhere on
// Character. It is scoped to the roll's own zone snapshot for two reasons: it
// is a hold on LEAVING one zone, not on walking, and a GM who relocates
// somebody out of the caves has then not also stranded them wherever they
// land. Marking the roll resolved is the only other thing that clears it.
const CAVING_HOLD_REASON =
  "You rolled a 1, so you can't leave the zone until your caving die are adjudicated.";

async function cavingHoldFor(prisma, characterId, zoneId) {
  if (!characterId || !zoneId) return null;
  const open = await prisma.cavingRoll.findFirst({
    where: { characterId, zoneId, kind: "TROUBLE", resolvedAt: null },
    select: { id: true },
  });
  return open ? CAVING_HOLD_REASON : null;
}

// The same question for a whole party at once, so an escort's follower loop
// asks it in one query instead of one per follower. Returns a Set of ids.
async function cavingHeldIds(prisma, characterIds, zoneId) {
  if (!zoneId || !characterIds?.length) return new Set();
  const rows = await prisma.cavingRoll.findMany({
    where: { characterId: { in: characterIds }, zoneId, kind: "TROUBLE", resolvedAt: null },
    select: { characterId: true },
  });
  return new Set(rows.map((r) => r.characterId));
}

// There used to be a push-time release valve here
// (releaseUnresolvedCavingRolls, docs/systemdocs/CAVING.md §2d): every
// unresolved TROUBLE row still open when a turn was pushed got auto-resolved,
// on the argument that the Caving lens goes read-only on a past turn and a
// roll nobody reached would otherwise be a roll nobody COULD reach.
//
// It is gone on purpose. A 1 now holds a caver until a GM actually resolves
// it, full stop — the push no longer lets go for them. What replaced the
// escape hatch: a stale unresolved TROUBLE row rides along on the OPEN turn's
// live Caving lens (web/app/(desk)/gm/turns/[[...selection]]/page.js), not just
// in read-only History, and CavingDesk keeps the Result box and Mark resolved
// live for an unresolved roll even when opened from History. See CAVING.md
// §2d for the full account.

module.exports = {
  rollCavingOnArrival,
  cavingHoldFor,
  cavingHeldIds,
  CAVING_HOLD_REASON,
};
