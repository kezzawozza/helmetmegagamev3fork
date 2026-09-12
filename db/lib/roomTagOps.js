// Tag adds and removes against a ROOM's stash — the floor's answer to
// db/lib/tagOps.js, used by the adjudication desk's staged room effects
// (docs/systemdocs/ADJUDICATION.md §1).
//
// Why this is a separate module and not a `roomId` branch in tagOps.js: every
// interesting path in applyTagOpsInTx is about a body. The equip batch,
// handsInTx, findEquipProblem, clampEquippedQuantity, the removesInto
// aftermath through grantTagSlugs — none of it has a meaning on a floor, and
// all of it is keyed on characterId. What is left once you take those out is
// this file.
//
// Takes `tx` first and stays off the @lifeweb/db barrel, the db/lib/dm.js
// convention. Throws TagOpError rather than a new class, so the staged push's
// existing catch arm stamps a bad row Errored with no changes of its own.

const { TagOpError } = require("./tagOps");
const { addToRoomStack, dropRoomTag } = require("./tagWrites");
const { expiryForGrant } = require("./grantExpiry");

// Shape only, and deliberately NOT validateTagOps. That one refuses a quantity
// above 1 on a non-stackable tag, which is a rule about what one CHARACTER can
// hold — two players can each leave their Longbow on the same floor, and
// addToRoomStack applies no pin for exactly that reason (see its header). The
// pin is re-applied on the way back out, when somebody picks the thing up.
//
// No `equippable` check either: a room wears nothing.
function validateRoomTagOps(ops, tagsById) {
  for (const op of ops ?? []) {
    const tag = tagsById.get(op.tagId);
    if (!tag) throw new TagOpError("One of those tags no longer exists.");
    if (!["add", "remove"].includes(op.op)) {
      throw new TagOpError("Only add and remove can be staged onto a room.");
    }
    const qty = op.quantity ?? 1;
    if (!Number.isInteger(qty) || qty < 1) {
      throw new TagOpError("Quantities must be whole numbers of at least 1.");
    }
  }
}

// Applies `ops` to one room and returns a snapshot array in exactly the shape
// applyTagOpsInTx returns, so the desk's effectSegments needs no second
// vocabulary.
//
// Removes run before adds, the same load-bearing order tagOps.js documents: a
// GM swapping one thing for another must not have the add merged into the
// stack the remove was about to take from.
//
// Both writers take the Room row lock themselves (tagWrites.js#lockRoom), and
// a row touches exactly one room, so there is no lock-ordering work here and
// no two-room deadlock to avoid. tagWrites.js' "character locks first" rule is
// satisfied vacuously — this module never touches a Character.
async function applyRoomTagOpsInTx(tx, { roomId, ops, tagsById, openTurn }) {
  const applied = [];
  const removes = (ops ?? []).filter((o) => o.op === "remove");
  const adds = (ops ?? []).filter((o) => o.op === "add");

  for (const op of removes) {
    const tag = tagsById.get(op.tagId);
    const quantity = op.quantity ?? null;
    // dropRoomTag reports `ok: false` rather than throwing when the stack no
    // longer covers the ask — a concurrent taker got there first, or the GM
    // was working from a stale view. Fail the whole row: it rolls back clean,
    // the claim included, and the tray shows a verdict. Quietly removing
    // nothing would tell a GM their adjudication applied when it did not.
    // A null quantity means "the whole stack" and always succeeds, so the
    // common case never reaches this.
    const { ok, poisonedTaken, poisonPayload } = await dropRoomTag(tx, roomId, op.tagId, quantity);
    if (!ok) {
      throw new TagOpError(`There isn't ${quantity} × ${tag.name} here to take.`);
    }
    applied.push({
      op: "remove",
      tagId: op.tagId,
      name: tag.name,
      quantity,
      // Recorded for the trail, acted on by nothing. A poisoned unit taken off
      // a floor by a GM is destroyed, not handed onward — there is no
      // recipient to carry the dose to (docs/systemdocs/MEDICAL.md).
      ...(poisonedTaken ? { poisonedTaken, poisonPayload } : {}),
    });
    // No removesInto aftermath. A treated wound leaving a scar behind is a
    // fact about a body (docs/systemdocs/TAGS.md §5c); a floor has no wounds,
    // and grantTagSlugs — the thing that would mint the remnant — only knows
    // how to put a tag on a character. Deliberate, not an oversight.
  }

  for (const op of adds) {
    const tag = tagsById.get(op.tagId);
    const quantity = op.quantity ?? 1;
    // Room tags expire on the same clock character tags do — db/index.js'
    // expiry sweep deletes RoomTag rows on expiresTurn and runs
    // sweepExpiredStacks over roomTag right beside the character pass. A null
    // here would quietly make a timed tag permanent, which is the bug
    // grantExpiry.js exists to prevent. characterId is null because
    // expiryForGrant only wants it for an audit row it writes when no turn is
    // open, and the push always has one.
    const expiresTurn = await expiryForGrant(tx, tag, openTurn, {
      characterId: null,
      where: "roomTagOps",
    });
    // No poison passed: a GM grant has nothing to inherit a dose from, so the
    // units land clean.
    await addToRoomStack(tx, roomId, op.tagId, quantity, { expiresTurn });
    applied.push({ op: "add", tagId: op.tagId, name: tag.name, quantity });
  }

  return applied;
}

module.exports = { validateRoomTagOps, applyRoomTagOpsInTx };
