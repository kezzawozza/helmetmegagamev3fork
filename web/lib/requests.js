import { prisma } from "@lifeweb/db";
import { MAX_REASON_LENGTH } from "@/lib/constants";
import { UserError } from "@/lib/actionResult";
import { DEAD_SIMPLE_PER_TURN, isDeadSimple } from "@/lib/tagRequests";

// What is left of the old Request system: the per-turn rations, and the one
// helper every player action writes its audit row through. A player action
// applies its effect and logs it in the same transaction, and there is no
// review step and no Undo. See docs/systemdocs/REQUESTS.md.

export { MAX_REASON_LENGTH };

// The free pool a medic's 0-turn cures share, whatever their tier
// (docs/systemdocs/TAGS.md §5c, M2). First aid, bandaging, setting a simple
// break — cures repriced to `turnsCost: 0` — are free actions up to this many
// a turn; past it, each one spills into the medical family's Move at 1/4
// (web/lib/craftBudget.js#craftMoveCost). This replaced the old per-tier
// MEDICAL_TIER_CAPS, which rationed every cure that cost a TURN — those are
// billed the Move's own fractions now (CRAFTING.md §2a), and no longer
// counted here at all.
//
// Gambits are not counted here either: a gambit heal files a Move, and
// Action's @@unique([characterId, turnId]) already allows exactly one of those
// a turn.
export const MEDICAL_SIMPLE_PER_TURN = 4;

// isDeadSimple and DEAD_SIMPLE_PER_TURN live in tagRequests.js now (recipe
// facts a client component can reach); imported above for the counters below
// and re-exported further down so server-side imports keep working.

// The free allowance a 0-turn recipe has each turn: its own `perTurn` ration
// if it sets one, otherwise the shared Dead Simple pool. Null means "no
// allowance to count" — either the recipe costs a Move (so the Action rations
// it) or it is a 0-turn recipe outside both schemes, which stays a free
// action with no ceiling.
//
// Units past the allowance are no longer simply refused: for a recipe with a
// craft family they spill into the Move at 1/allowance each
// (web/lib/craftBudget.js, docs/systemdocs/CRAFTING.md §2a). This function is
// only the number, so the server's enforcement and the page's readout can
// never disagree about what "free" means.
export function craftAllowance(tag) {
  if ((tag?.requirementTurns ?? 1) !== 0) return null;
  if (tag?.requirementPerTurn != null) return tag.requirementPerTurn;
  return isDeadSimple(tag) ? DEAD_SIMPLE_PER_TURN : null;
}

// Units of ONE recipe already made this turn, for a tag that sets its own
// `perTurn` (Tag.requirementPerTurn). Distinct from the Dead Simple pool
// below: that one is a shared allowance across every 0-turn recipe, this is a
// ration on a single item.
//
// Every counter here counts `request_craft_tag` AuditLog rows — the one row
// grantCrafted writes per grant — because that row is the whole record of a
// craft now (REQUESTS.md §1a). `AuditLog.turnId` is what separates this
// turn's work from last turn's.
// A custom craft grants a MINTED row and records the recipe it came off as
// `details.baseTagId` (grantCrafted) — the ration is a fact about the
// RECIPE, so every counter here bills against that id, or three custom
// Lavish Meals would dodge the three-a-turn the plain ones obey.
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

// Dead Simple units already filed this turn (DEAD_SIMPLE_PER_TURN).
// `db` is prisma or a tx client.
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

// Every rationed recipe's free units left this turn, in one query, keyed by
// tag id: `{ per, left }`. The Craft dialog's readout, so it can say which
// units of an order are free and which spill into the Move. `tags` is the
// page's catalog rows — they must carry `requirementTurns`,
// `requirementPerTurn` and `requirementSkills.slug` or nothing is rationed.
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

// Server actions are public endpoints, so the reason is validated here rather
// than trusted from the dialog that collected it.
export function requireReason(raw) {
  const reason = raw?.toString().trim() ?? "";
  if (!reason) throw new UserError("A reason is required.");
  return reason.slice(0, MAX_REASON_LENGTH);
}


// A player action writes one AuditLog row and nothing else. There is no
// Request table any more and no Undo: the player acts, the row records what
// happened, and a GM repairs by hand from /gm/dev if they must. `details` is
// therefore the ONLY record — where the old Request.effect carried a restore
// snapshot, that snapshot belongs in here now.
export function logAudit(tx, { actorDiscordUserId, actionType, targetCharacterId, turnId, details }) {
  return tx.auditLog.create({
    data: {
      actorDiscordUserId,
      actionType,
      targetCharacterId: targetCharacterId ?? null,
      turnId: turnId ?? null,
      details: details ?? {},
    },
  });
}

