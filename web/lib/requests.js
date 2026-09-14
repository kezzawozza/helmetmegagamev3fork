import { prisma, placePairForAudit } from "@lifeweb/db";
import { MAX_REASON_LENGTH } from "@/lib/constants";
import { DEAD_SIMPLE_PER_TURN, isDeadSimple } from "@/lib/tagRequests";

// What is left of the old Request system: the per-turn rations, and the one helper every player action writes its audit row through. See docs/systemdocs/REQUESTS.md.

export { MAX_REASON_LENGTH };

// The free pool a medic's 0-turn cures share, whatever their tier (TAGS.md §5c, M2); past it, spills into the medical family's Move at 1/4 (craftBudget.js#craftMoveCost).
export const MEDICAL_SIMPLE_PER_TURN = 4;

// isDeadSimple and DEAD_SIMPLE_PER_TURN live in tagRequests.js now; re-exported below.

// The free allowance a 0-turn recipe has each turn: its own `perTurn` ration, else the shared Dead
// Simple pool, else null. Past it, units spill into the Move at 1/allowance each (craftBudget.js, CRAFTING.md §2a).
export function craftAllowance(tag) {
  if ((tag?.requirementTurns ?? 1) !== 0) return null;
  if (tag?.requirementPerTurn != null) return tag.requirementPerTurn;
  return isDeadSimple(tag) ? DEAD_SIMPLE_PER_TURN : null;
}

// Units of ONE recipe made this turn (Tag.requirementPerTurn); a custom craft bills against `details.baseTagId`, its base recipe, so custom Lavish Meals don't dodge the plain ones' ration.
function effectiveTagId(details) {
  return details?.baseTagId ?? details?.tagId;
}

function craftsThisTurn(db, characterId, turnId) {
  if (!turnId) return [];
  return db.auditLog.findMany({
    where: {
      targetCharacterId: characterId,
      actionType: "request_craft_tag",
      turnId,
    },
    select: { details: true },
  });
}

export async function unitsOfTagThisTurn(db, characterId, turnId, tagId) {
  const filed = await craftsThisTurn(db, characterId, turnId);
  return filed.reduce((sum, r) => {
    if (effectiveTagId(r.details) !== tagId) return sum;
    return sum + (Number(r.details?.quantity) || 0);
  }, 0);
}

export async function deadSimpleUnitsThisTurn(db, characterId, turnId) {
  const filed = await craftsThisTurn(db, characterId, turnId);
  const filedTagIds = [
    ...new Set(filed.map((r) => effectiveTagId(r.details)).filter(Boolean)),
  ];
  const filedTags = filedTagIds.length
    ? await db.tag.findMany({
        where: { id: { in: filedTagIds } },
        select: {
          id: true,
          requirementTurns: true,
          requirementSkills: { select: { slug: true } },
        },
      })
    : [];
  const deadSimpleIds = new Set(filedTags.filter(isDeadSimple).map((t) => t.id));
  return filed.reduce((sum, r) => {
    if (!deadSimpleIds.has(effectiveTagId(r.details))) return sum;
    return sum + (Number(r.details?.quantity) || 0);
  }, 0);
}

// Every rationed recipe's free units left this turn, keyed by tag id: `{ per, left }`. The Craft
// dialog's readout; `tags` must carry `requirementTurns`, `requirementPerTurn` and `requirementSkills.slug`.
export async function craftFreeUnits(db, characterId, turnId, tags) {
  const out = {};
  const rationed = tags.filter((t) => craftAllowance(t) != null);
  if (!turnId || !rationed.length) return out;
  const filed = await craftsThisTurn(db, characterId, turnId);
  const units = new Map();
  for (const r of filed) {
    const id = effectiveTagId(r.details);
    if (!id) continue;
    units.set(id, (units.get(id) ?? 0) + (Number(r.details?.quantity) || 0));
  }
  const byId = new Map(tags.map((t) => [t.id, t]));
  let pool = 0;
  for (const [id, n] of units) {
    if (isDeadSimple(byId.get(id))) pool += n;
  }
  for (const tag of rationed) {
    const per = craftAllowance(tag);
    const used = tag.requirementPerTurn != null ? (units.get(tag.id) ?? 0) : pool;
    out[tag.id] = { per, left: Math.max(0, per - used) };
  }
  return out;
}


// A player action writes one AuditLog row and nothing else — no Request table, no Undo; `details` is
// the ONLY record. `place` (for /gm/audit's filter) is optional: {locationId, roomId}, a character, or a place key (db/lib/placeKey.js).
export async function logAudit(tx, { actorDiscordUserId, actionType, targetCharacterId, turnId, details, place }) {
  const { locationId, roomId } = await placePairForAudit(tx, place);
  return tx.auditLog.create({
    data: {
      actorDiscordUserId,
      actionType,
      targetCharacterId: targetCharacterId ?? null,
      turnId: turnId ?? null,
      details: details ?? {},
      locationId,
      roomId,
    },
  });
}
