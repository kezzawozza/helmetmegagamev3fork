// The minute sweep behind the rites (docs/systemdocs/THANATI.md §4): expires
// attempts nobody finished in twelve hours, fires the READY ones once their
// two-minute grace has run, and cancels any whose room has gone. The bot runs
// it every minute (bot/src/events/ready.js); firing is therefore within a
// minute of the mark, not on the second.
//
// Firing re-resolves everything — somebody may have pocketed the heart, or the
// bound man may have been freed — and a missing ingredient sends the attempt
// back to OPEN with its clock cleared, so more chanting can arm it again inside
// the window. Then, in one transaction, the attempt is claimed and the floor
// eaten; the rite's EFFECT runs after that on the top-level client
// (db/lib/riteEffects.js), and whatever it reports is written on the row.
//
// Takes `db` as a parameter, the db/lib/dm.js convention.
const { WINDOW_MS, riteByKey, floorIngredients } = require("./rites");
const { distinctChanters, ROOM_SELECT } = require("./riteChant");
const { resolveIngredients } = require("./riteIngredients");
const { EFFECTS } = require("./riteEffects");
const { dropRoomTag } = require("./tagWrites");
const { takeRoomResources } = require("./resourceStack");

async function consumeFloor(tx, rite, roomId) {
  for (const need of floorIngredients(rite)) {
    if (need.resources) {
      // STRICT, like the dropRoomTag below it: the whole amount comes off the
      // floor or the rite does not fire. That is what the guarded `gte`
      // updateMany was before ⬢ became a stack.
      if (!(await takeRoomResources(tx, roomId, need.resources))) return false;
    }
    if (need.tag) {
      const tag = await tx.tag.findUnique({ where: { slug: need.tag }, select: { id: true } });
      if (!tag) return false;
      // `.ok` — dropRoomTag returns an object, so testing the call is always truthy.
      if (!(await dropRoomTag(tx, roomId, tag.id, need.count ?? 1)).ok) return false;
    }
  }
  return true;
}

async function fireAttempt(db, attempt) {
  const rite = riteByKey(attempt.riteKey);
  const room = rite ? await db.room.findUnique({ where: { id: attempt.roomId }, select: ROOM_SELECT }) : null;
  if (!rite || !room) {
    await db.riteAttempt.update({ where: { id: attempt.id }, data: { status: "CANCELLED" } });
    return { fired: false };
  }

  const chanters = await distinctChanters(db, attempt.id);
  const alive = await db.character.findMany({
    where: { id: { in: chanters.map((c) => c.characterId) }, status: "ALIVE" },
    select: { id: true, name: true, discordUserId: true },
  });
  const participants = alive.map((c) => ({ characterId: c.id, name: c.name, discordUserId: c.discordUserId }));

  // Gone since READY — an ingredient, or the target it needed: back to OPEN,
  // clock cleared, and the next chant re-judges it.
  const ingredients = await resolveIngredients(db, rite, room, { participants });
  if (!ingredients.ok || participants.length < rite.minChanters) {
    // GUARDED on READY, like the claim below. Without the predicate a second
    // sweep — a rolling deploy runs two bot containers, and ready.js's
    // re-entrancy flag is per-process — could resolve this attempt while the
    // first sweep was firing it, find the floor "missing" because the first
    // sweep had just eaten it, and stomp a FIRED row back to OPEN. That loses
    // the result, strands an AWAITING Panic where nothing can answer it, and
    // leaves the original chants in place so the next chant re-arms and fires
    // the same rite a second time.
    const { count } = await db.riteAttempt.updateMany({
      where: { id: attempt.id, status: "READY" },
      data: { status: "OPEN", readyAt: null, firesAt: null, result: { rearmed: ingredients.missing } },
    });
    return { fired: false, rearmed: count > 0 };
  }

  // Claim it and eat the floor together: a second sweep racing this one finds
  // nothing to fire, and a floor that changed underneath rolls the claim back.
  let claimed = false;
  await db
    .$transaction(async (tx) => {
      const { count } = await tx.riteAttempt.updateMany({
        where: { id: attempt.id, status: "READY" },
        data: { status: "FIRED", firedAt: new Date(), participants },
      });
      if (count === 0) return;
      if (!(await consumeFloor(tx, rite, room.id))) throw new Error("floor changed under the rite");
      claimed = true;
    })
    .catch((err) => {
      console.error(`Rite ${rite.key} in ${room.name} did not fire:`, err.message ?? err);
      claimed = false;
    });
  if (!claimed) return { fired: false };

  const openTurn = await db.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } });
  // The number a TIMED tag grant needs, which is not always openTurn.number.
  // A rite fires off a minute cron, so it lands inside a turn advance — and
  // advanceTurn leaves nothing OPEN between flipping the old turn RESOLVED and
  // creating the next, for as long as that takes, or for hours if it wedges
  // (db/lib/grantExpiry.js). grantTagSlugs THROWS on a timed tag with no turn
  // number rather than landing it permanent, and by here the floor is already
  // eaten — so the throw would cost the circle its ingredients for nothing.
  // The turn a grant belongs to in that window is the one about to open.
  const grantTurnNumber =
    openTurn?.number ??
    ((await db.turn.findFirst({ orderBy: { number: "desc" }, select: { number: true } }))?.number ?? 0) + 1;
  const effect = EFFECTS[rite.key];
  let outcome;
  try {
    outcome = effect
      ? await effect({ db, rite, attempt, room, location: room.location, participants, resolved: ingredients.resolved, openTurn, grantTurnNumber })
      : { result: { unscripted: true } };
  } catch (err) {
    console.error(`Rite ${rite.key} in ${room.name} effect failed:`, err.message ?? err);
    outcome = { result: { error: err.message ?? String(err) } };
  }

  // Also guarded: this sweep claimed the row as FIRED above, so only it may
  // move the row on to AWAITING or write the result.
  await db.riteAttempt.updateMany({
    where: { id: attempt.id, status: "FIRED" },
    data: { status: outcome.awaiting ? "AWAITING" : "FIRED", result: outcome.result ?? null },
  });
  await db.auditLog
    .create({
      data: {
        actorDiscordUserId: participants[0]?.discordUserId ?? "system",
        actionType: "rite_fired",
        details: { rite: rite.name, riteKey: rite.key, room: room.name, roomId: room.id, participants, result: outcome.result ?? null },
      },
    })
    .catch((err) => console.error("Rite audit row failed:", err.message ?? err));

  return { fired: true, rite, room, participants, result: outcome.result };
}

async function runRiteSweep(db) {
  const now = new Date();
  const expired = await db.riteAttempt.updateMany({
    where: { status: { in: ["OPEN", "AWAITING"] }, openedAt: { lt: new Date(now.getTime() - WINDOW_MS) } },
    data: { status: "EXPIRED" },
  });

  const due = await db.riteAttempt.findMany({
    where: { status: "READY", firesAt: { lte: now } },
    orderBy: { firesAt: "asc" },
  });
  let fired = 0;
  for (const attempt of due) {
    const outcome = await fireAttempt(db, attempt);
    if (outcome.fired) fired += 1;
  }
  return { expired: expired.count, fired };
}

module.exports = { runRiteSweep, fireAttempt };
