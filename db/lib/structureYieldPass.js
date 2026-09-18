// What a building MAKES, every turn, by standing there. A structure type declares `placement.yields: { tag, room, quantity }` in docs/tags.yaml
// and this pours it into that Room's floor at every close (the Brewery racks a cask in the inn cellar). THE PRODUCE GOES ON A FLOOR, NOT INTO
// POCKETS — a stash is a place people walk to, carry from, and can be robbed of. The destination room need NOT be the structure's own Location —
// naming it by slug is what lets the brewery at the inn fill the cellar under it. SOMEBODY HAS TO BE MINDING IT: `yields.skill` names a skill, and
// the turn produces nothing unless a living character counting as having it stands at the structure's Location at close. "Counts as" is the tier
// ladder, so Brewing II satisfies a `brewing-basic` requirement even though it replaces the lower row outright (tagWrites.js#replaceLowerTiers).

const { addToRoomStack } = require("./tagWrites");
const { ambientLine } = require("./ambientLine");
const { postMessage } = require("./discordRest");
const { placementOf } = require("./structures");
const { buildSkillAncestry, satisfiedSkillIds } = require("./medicalVision");
const { alivePassCharacters } = require("./aliveCharacters");

// Structures that are actually WORKING. Deliberately COMPLETE only, stricter than WORKING_STATUSES: a damaged brewery is one nobody is minding.
const YIELDING_STATUSES = ["COMPLETE"];

// Does anybody standing here count as having `skillSlug`? Holding Brewing II REPLACES the Brewing I row rather than adding to it, so a plain
// slug test would miss the brewer. satisfiedSkillIds walks each held tag's parent chain, the same answer requireRecipeSkills gives a crafter.
async function someoneTending(prisma, locationId, skillSlug) {
  if (!locationId) return false;
  const skill = await prisma.tag.findUnique({ where: { slug: skillSlug }, select: { id: true } });
  // A skill slug the catalog does not have: fail SOFT and OPEN — a building that quietly stopped working is harder to notice than one that kept going.
  if (!skill) {
    console.warn(`structureYield: yields.skill "${skillSlug}" is not a tag — not gating on it.`);
    return true;
  }
  const here = await alivePassCharacters(prisma, {
    where: { locationId },
    select: { tags: { select: { tagId: true } } },
  });
  if (!here.length) return false;
  const catalog = await prisma.tag.findMany({ select: { id: true, parentTagId: true } });
  const ancestry = buildSkillAncestry(catalog);
  return here.some((c) => satisfiedSkillIds(c.tags.map((ct) => ct.tagId), ancestry).has(skill.id));
}

async function runStructureYieldPass(prisma, turn) {
  const result = { poured: 0, skipped: 0, untended: 0, lines: [] };
  if (!turn?.id) return result;

  const rows = await prisma.structure.findMany({
    where: { status: { in: YIELDING_STATUSES } },
    select: { id: true, typeSlug: true, typeName: true, locationId: true, lastUpkeepTurnId: true },
  });
  if (!rows.length) return result;

  // One query for the catalog, joined in JS — typeSlug is a string rather than a relation on purpose (schema.prisma).
  const types = await prisma.tag.findMany({
    where: { slug: { in: [...new Set(rows.map((r) => r.typeSlug))] } },
    select: { id: true, slug: true, placement: true },
  });
  const yieldsBySlug = new Map();
  for (const t of types) {
    const y = placementOf(t)?.yields;
    if (y) yieldsBySlug.set(t.slug, y);
  }
  if (!yieldsBySlug.size) return result;

  for (const row of rows) {
    const spec = yieldsBySlug.get(row.typeSlug);
    if (!spec) continue;
    // Per-row try/catch: one bad catalog entry must not cost the whole pass.
    try {
      // THE CLAIM, and the reason this pass is safe to re-enter — "did I already pour for this turn" has to be answerable from the row itself,
      // via lastUpkeepTurnId. Conditional updateMany, so the WHERE is the check: two advances racing cannot both pour.
      // The OR-with-null is NOT decoration: `NOT: { lastUpkeepTurnId: turn.id }` evaluates to UNKNOWN (not true) when the column is NULL, so a
      // structure that had never yielded would match nothing and pour zero forever. Same shape as the Bird's day claim (requestActions.js).
      const { count } = await prisma.structure.updateMany({
        where: {
          id: row.id,
          OR: [{ lastUpkeepTurnId: null }, { lastUpkeepTurnId: { not: turn.id } }],
        },
        data: { lastUpkeepTurnId: turn.id },
      });
      if (count === 0) continue;

      // Cross-master references (docs/tags.yaml names a room from docs/zones.yaml, and the two syncs run independently, SYNC.md) fail SOFT —
      // a rename leaves a brewery that makes nothing and says so in the log, rather than throwing a turn close.
      const [room, tag] = await Promise.all([
        prisma.room.findUnique({
          where: { slug: spec.room },
          select: { id: true, name: true, discordThreadId: true },
        }),
        prisma.tag.findUnique({ where: { slug: spec.tag }, select: { id: true, name: true } }),
      ]);
      if (!room || !tag) {
        console.warn(
          `structureYield: ${row.typeName} yields ${spec.quantity}× "${spec.tag}" into "${spec.room}" — ${!room ? "no such room" : "no such tag"}. Nothing poured.`,
        );
        result.skipped += 1;
        continue;
      }

      // Read AFTER the claim above: an unminded turn is still accounted for, so a brewery nobody tended does not bank the day and pour two tomorrow.
      if (spec.skill) {
        const minded = await someoneTending(prisma, row.locationId, spec.skill);
        if (!minded) {
          result.untended += 1;
          continue;
        }
      }

      await prisma.$transaction(async (tx) => {
        await addToRoomStack(tx, room.id, tag.id, spec.quantity);
      });
      result.poured += 1;
      if (room.discordThreadId) {
        result.lines.push({
          threadId: room.discordThreadId,
          text: ambientLine(`The brewery generated one alcohol.`),
        });
      }
    } catch (err) {
      console.error(`structureYield failed for ${row.typeName} (${row.id}):`, err);
      result.skipped += 1;
    }
  }

  // Scenery, posted best-effort and catch-logged rather than through the turn's side-effect ledger — the STATE is already durable above, so the
  // worst a lost post costs is somebody finding the beer instead of being told. Sequential, not Promise.all — same rate-limit discipline as soundBroadcast.js.
  for (const line of result.lines) {
    await postMessage(line.threadId, line.text).catch((err) =>
      console.error("Structure yield line failed:", err),
    );
  }

  return result;
}

module.exports = { runStructureYieldPass, YIELDING_STATUSES };
