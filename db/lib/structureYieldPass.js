// What a building MAKES, every turn, by standing there.
//
// A structure type declares `placement.yields: { tag, room, quantity }` in
// docs/tags.yaml and this pours it into that Room's floor at every close. The
// Brewery is the first and so far only one: it stands at the Old Cock Inn and
// racks a cask down in the inn cellar.
//
// THE PRODUCE GOES ON A FLOOR, NOT INTO POCKETS, and that is the whole design.
// An earlier draft handed a bottle to everyone standing at the Location, which
// made a 15 ⬢ building into the best mood engine in the game — Alcohol is +30
// on consume, the largest single lift there is (MOOD.md §6), and Ecstatic's
// brake had shipped the day before on the argument that the good half of the
// dial is meant to cost something. A stash is a place people have to walk to,
// carry from, and can be robbed of. `inn-cellar` is keyed (`access: [inn-key]`
// in docs/zones.yaml), so the beer belongs to somebody in particular.
//
// The destination room need NOT be at the structure's own Location — naming it
// by slug is what lets the brewery at the inn fill the cellar under it.
//
// SOMEBODY HAS TO BE MINDING IT. `yields.skill` names a skill, and the turn
// produces nothing unless a living character who counts as having it is
// standing at the structure's Location when the turn closes. A brewery is not
// a machine; it is a trade, and it runs while a brewer is there and stops when
// they wander off. "Counts as" is the tier ladder, so Brewing (Skilled)
// satisfies a `brewing-basic` requirement even though holding the higher tier
// replaces the lower row outright (db/lib/tagWrites.js#replaceLowerTiers).
//
// Takes `prisma` as a parameter and stays off the @lifeweb/db barrel, the
// db/lib/dm.js convention; require it by path.

const { addToRoomStack } = require("./tagWrites");
const { ambientLine } = require("./ambientLine");
const { postMessage } = require("./discordRest");
const { placementOf } = require("./structures");
const { buildSkillAncestry, satisfiedSkillIds } = require("./medicalVision");
const { alivePassCharacters } = require("./aliveCharacters");

// Structures that are actually WORKING. Deliberately COMPLETE only, and
// stricter than WORKING_STATUSES: a palisade still fences you in when it is
// DAMAGED, but a damaged brewery is one nobody is minding. Same call the
// labor bonus makes (db/lib/laborAccess.js).
const YIELDING_STATUSES = ["COMPLETE"];

// Does anybody standing here count as having `skillSlug`? The tier ladder is
// the whole subtlety: holding Brewing (Skilled) REPLACES the Basic row rather
// than adding to it, so a plain slug test would find no brewer in a room full
// of good ones. satisfiedSkillIds walks each held tag's parent chain, which is
// the same answer requireRecipeSkills gives a crafter.
async function someoneTending(prisma, locationId, skillSlug) {
  if (!locationId) return false;
  const skill = await prisma.tag.findUnique({ where: { slug: skillSlug }, select: { id: true } });
  // A skill slug the catalog does not have: fail SOFT and OPEN, matching how
  // the room and tag lookups below treat a cross-master rename. A building
  // that quietly stopped working would be much harder to notice than one that
  // kept going.
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

  // One query for the catalog, joined in JS — typeSlug is a string rather than
  // a relation on purpose (schema.prisma), so there is nothing to include.
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
    // Per-row try/catch: one bad catalog entry must not cost the whole pass,
    // the posture every other pass keeps.
    try {
      // THE CLAIM, and the reason this pass is safe to re-enter. The turn
      // engine records finished passes on Turn.resolvedPasses and a killed
      // advance resumes, so "did I already pour for this turn" has to be
      // answerable from the row itself. lastUpkeepTurnId has been sitting in
      // the schema unused for exactly this — its comment calls it "a claim
      // column for a FUTURE decay/upkeep pass". This is that pass.
      //
      // Conditional updateMany, so the WHERE is the check: two advances
      // racing cannot both pour.
      //
      // The OR-with-null is NOT decoration. `NOT: { lastUpkeepTurnId: turn.id }`
      // reads as `NOT (col = '…')`, which SQL evaluates to UNKNOWN — not true —
      // when the column is NULL, so a structure that had never yielded matched
      // nothing and every brewery in the game poured exactly zero. This is the
      // same shape the Bird's day claim spells out for the same reason
      // (requestActions.js), and it is the shape to copy.
      const { count } = await prisma.structure.updateMany({
        where: {
          id: row.id,
          OR: [{ lastUpkeepTurnId: null }, { lastUpkeepTurnId: { not: turn.id } }],
        },
        data: { lastUpkeepTurnId: turn.id },
      });
      if (count === 0) continue;

      // Cross-master references, resolved here rather than at sync time:
      // docs/tags.yaml names a room and a tag out of docs/zones.yaml and its
      // own catalog, and the two syncs run independently (SYNC.md). So both
      // fail SOFT — a rename leaves a brewery that makes nothing and says so
      // in the log, rather than throwing a turn close.
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

      // Is anybody minding it? Read AFTER the claim above on purpose: an
      // unminded turn is still a turn that has been accounted for, so a
      // brewery nobody tended does not bank the day and pour two tomorrow.
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

  // Scenery, posted best-effort and catch-logged rather than handed to the
  // turn's side-effect ledger. The ledger's payload is a fixed list of keys
  // that a resume replays, and a line saying a cask appeared is not worth a
  // new one: the STATE is already durable and already idempotent above, so
  // the worst a lost post costs is that somebody finds the beer instead of
  // being told about it. Sequential, not Promise.all — the rate-limit
  // discipline soundBroadcast.js and deathSmell.js both keep.
  for (const line of result.lines) {
    await postMessage(line.threadId, line.text).catch((err) =>
      console.error("Structure yield line failed:", err),
    );
  }

  return result;
}

module.exports = { runStructureYieldPass, YIELDING_STATUSES };
