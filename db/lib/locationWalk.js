// Walking across a zone — several hops on one press (MAP.md §3c).
//
// NOT A MOVER. Every step here is the real single-hop pair every other caller
// runs: db/lib/locationTravel.js#performLocationMove for the database half,
// then db/lib/locationMove.js#applyLocationMoveSideEffects for the Discord and
// game half. That is the whole design rather than an implementation detail —
// it is what makes the turrets, the ambushes, the gate lines, the arrival mood
// and the fog fire at EVERY stop along the road instead of only at the end.
// A jump straight to the destination would be a second mover, and this file
// writes no Character.locationId of its own.
//
// It lives above both halves, because it has to call both, and locationTravel.js
// is documented as doing no Discord work. It lives in db/lib/ because the web
// and the bot both walk people and must not each grow their own version.
//
// Sends NOTHING. It returns the DMs the way performLocationMove returns
// interceptDms — the caller sends them, outside any transaction.
//
// Deliberately NOT on the @lifeweb/db barrel; require it by path.
const { performLocationMove } = require("./locationTravel");
const { applyLocationMoveSideEffects } = require("./locationMove");
const { pathWithinZone } = require("./locationGraph");
const { knownLocations } = require("./locationVisits");
const { ESCORT_SELECT } = require("./escort");

// Walk `character` to `targetLocation`, hop by hop, inside their own zone.
//
// The return says where they ACTUALLY ended up, which is not always where they
// meant to go: `ok: false` only when the very first hop refused and nobody
// moved at all. Any later refusal is `ok: true, complete: false` with
// `stoppedBy`, because the ground they covered is real and they are standing on
// it — that is what lets a caller say "You got as far as the Yard."
async function walkWithinZone(prisma, character, targetLocation) {
  const { seen } = await knownLocations(prisma, character.id);
  const route = await pathWithinZone(prisma, character, targetLocation.id, { known: seen });
  if (!route.ok) return { ok: false, reason: route.reason };

  const merged = {
    moved: [],
    leftBehind: [],
    interceptDms: [],
    cavingDms: [],
    dismounted: [],
  };

  let row = character;
  let arrivedAt = null;
  let stoppedBy = null;

  for (const [index, step] of route.path.entries()) {
    // performLocationMove has NO status gate — its incapacitation check reads
    // tags (blockerFor(tags, ACT)) and death strips tags rather than granting
    // one. So a walker the Depot gun killed at hop 2 would march on to the
    // destination as a corpse. This line is the only thing standing between
    // that and a delivered body; do not remove it on the grounds that the
    // mover "surely checks".
    if (row.status !== "ALIVE") {
      stoppedBy = { reason: null, at: arrivedAt };
      break;
    }

    const hop = await performLocationMove(prisma, row, step, {
      // The first hop IS the debounce claim, exactly as a single hop is, so two
      // tabs starting a walk in the same tick still resolve to one. Every later
      // hop is covered by that one claim and swaps the clock for a check that
      // they are still standing where we read them.
      skipCooldown: index > 0,
    });

    if (!hop.ok) {
      if (index === 0) return { ok: false, reason: hop.reason, retryAfterSeconds: hop.retryAfterSeconds };
      stoppedBy = { reason: hop.reason, at: arrivedAt };
      break;
    }

    // Per moved character, exactly as a single hop's caller does it, and
    // sequential for the reason that loop is sequential: firing a whole party's
    // worth at once trips the invalid-response breaker (db/lib/discordRest.js).
    for (const entry of hop.moved) {
      await applyLocationMoveSideEffects(prisma, {
        characterId: entry.character.id,
        fromLocationId: entry.fromLocationId,
        toLocationId: entry.toLocationId,
        // Only ever the mover's own mount.
        dismounted: entry.character.id === character.id ? hop.dismounted : undefined,
        walked: true, // on foot, so the street behind them stays lit (db/lib/vantages.js)
      }).catch(() => {});
    }

    merged.moved.push(...hop.moved);
    merged.leftBehind.push(...(hop.leftBehind ?? []));
    merged.interceptDms.push(...(hop.interceptDms ?? []));
    merged.dismounted.push(...(hop.dismounted ?? []));
    for (const entry of hop.moved) {
      if (entry.cavingDm) merged.cavingDms.push(entry.cavingDm);
    }
    arrivedAt = hop.targetLocation;

    // Re-read before the next hop, and it has to be a re-read rather than a
    // patch of the row we hold: THREE of the things that matter are written by
    // applyLocationMoveSideEffects above, after the mover already returned —
    // `status` by a turret, `heldUntil` by somebody's watch firing, and `tags`
    // by a wound or a mount parked at a door. ESCORT_SELECT and not something
    // cheaper, because the next hop hands this row straight back to the mover,
    // which re-authorises the party off it (escort.js's missing-faction trap).
    row = await prisma.character.findUnique({ where: { id: character.id }, select: ESCORT_SELECT });
    if (!row) {
      stoppedBy = { reason: null, at: arrivedAt };
      break;
    }
  }

  return {
    ok: true,
    intended: targetLocation,
    arrivedAt: arrivedAt ?? null,
    complete: Boolean(arrivedAt && arrivedAt.id === targetLocation.id),
    hops: route.hops,
    stoppedBy,
    // The caller's cue that it must NOT run its own side-effect loop over
    // `moved` — every one of these already had theirs, per hop. Reusing that
    // loop here would fire every turret twice and re-roll every Caving Die.
    sideEffectsApplied: true,
    ...merged,
  };
}

module.exports = { walkWithinZone };
