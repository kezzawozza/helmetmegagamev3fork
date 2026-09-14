// Tag adds/removes against a ROOM's stash (docs/systemdocs/ADJUDICATION.md
// §1). Separate from db/lib/tagOps.js because every character-only path
// there has no meaning on a floor. Throws TagOpError so the staged push's
// catch arm stamps a bad row Errored with no changes.

const { TagOpError } = require("./tagOps");
const { addToRoomStack, dropRoomTag } = require("./tagWrites");
const { expiryForGrant } = require("./grantExpiry");

// Shape only, deliberately NOT validateTagOps: the non-stackable-quantity rule
// is about what one CHARACTER can hold, not a floor. No `equippable` check
// either: a room wears nothing.
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

// Snapshot shape matches applyTagOpsInTx. Removes run before adds (tagOps.js'
// load-bearing order): a swap must not merge the add into the stack the
// remove was about to take from — this module never touches a Character, so
// there's no lock-ordering to avoid. `econ` is forwarded so a staged grant
// doesn't read as UNATTRIBUTED on /gm/economy (DEPOT.md §0g).
async function applyRoomTagOpsInTx(tx, { roomId, ops, tagsById, openTurn, econ = {} }) {
  const applied = [];
  const removes = (ops ?? []).filter((o) => o.op === "remove");
  const adds = (ops ?? []).filter((o) => o.op === "add");

  for (const op of removes) {
    const tag = tagsById.get(op.tagId);
    const quantity = op.quantity ?? null;
    // Fail the whole row on ok:false so it rolls back clean, not silently.
    const { ok, poisonedTaken, poisonPayload } = await dropRoomTag(tx, roomId, op.tagId, quantity, {
      econ: { ...econ, reason: econ.reason ?? "GM_TAKE" },
    });
    if (!ok) {
      throw new TagOpError(`There isn't ${quantity} × ${tag.name} here to take.`);
    }
    applied.push({
      op: "remove",
      tagId: op.tagId,
      name: tag.name,
      quantity,
      // For the trail only: a poisoned unit is destroyed, not handed onward.
      ...(poisonedTaken ? { poisonedTaken, poisonPayload } : {}),
    });
    // No removesInto: a floor has no wounds to scar (TAGS.md §5c).
  }

  for (const op of adds) {
    const tag = tagsById.get(op.tagId);
    const quantity = op.quantity ?? 1;
    // Room tags expire on the same clock character tags do; a null here
    // would quietly make a timed tag permanent.
    const expiresTurn = await expiryForGrant(tx, tag, openTurn, {
      characterId: null,
      where: "roomTagOps",
    });
    // No poison passed: a GM grant has nothing to inherit a dose from.
    await addToRoomStack(tx, roomId, op.tagId, quantity, {
      expiresTurn,
      econ: { ...econ, reason: econ.reason ?? "GM_GRANT" },
    });
    applied.push({ op: "add", tagId: op.tagId, name: tag.name, quantity });
  }

  return applied;
}

module.exports = { validateRoomTagOps, applyRoomTagOpsInTx };
