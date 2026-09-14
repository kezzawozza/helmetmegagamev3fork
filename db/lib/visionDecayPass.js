// Five drinks of Moonshine and the lights go out. {tag:damaged-vision} is the only stackable tag in the catalog whose COUNT means something — nothing else in the engine reads a quantity as a threshold, so counting is a pass of its own.
// The whole stack comes off when it fires. Blind is terminal enough that leaving four notches behind would only ask "damaged toward what?"
// Takes `prisma` as a parameter — see db/lib/dm.js for why.
const { BLIND_SLUG } = require("./examineVision");

const DAMAGED_VISION_SLUG = "damaged-vision";
const BLIND_AT = 5;

const WENT_BLIND_DM =
  "You're now blind.";

async function runVisionDecayPass(prisma, turn) {
  const rows = await prisma.characterTag.findMany({
    where: {
      quantity: { gte: BLIND_AT },
      tag: { slug: DAMAGED_VISION_SLUG },
      character: { status: "ALIVE" },
    },
    select: {
      id: true,
      characterId: true,
      quantity: true,
      character: { select: { name: true, discordUserId: true } },
    },
  });
  // An object, not null: db/index.js reads null as "retry next advance" and gates markDone on truthiness.
  if (rows.length === 0) return { turnNumber: turn.number, blinded: 0, dms: [] };

  const blind = await prisma.tag.findUnique({ where: { slug: BLIND_SLUG }, select: { id: true } });
  if (!blind) {
    console.error(`Vision decay: no "${BLIND_SLUG}" tag — run npm run db:sync-tags. Nobody will go blind.`);
    return { turnNumber: turn.number, blinded: 0, dms: [] };
  }

  const blinded = [];
  for (const row of rows) {
    try {
      await prisma.$transaction(async (tx) => {
        // The delete is the claim: deleteMany matching nothing means somebody else already handled this character.
        const { count } = await tx.characterTag.deleteMany({ where: { id: row.id } });
        if (count === 0) return;
        // skipDuplicates rather than an upsert: an already-Blind character keeps their own row, same rule as db/lib/tagExpiryPass.js.
        await tx.characterTag.createMany({
          data: [{ characterId: row.characterId, tagId: blind.id, source: "EVENT", expiresTurn: null }],
          skipDuplicates: true,
        });
        blinded.push(row);
      });
    } catch (err) {
      console.error(`Vision decay for character ${row.characterId} failed:`, err);
    }
  }

  return {
    turnNumber: turn.number,
    blinded: blinded.length,
    characterIds: blinded.map((r) => r.characterId),
    dms: blinded
      .filter((r) => r.character?.discordUserId)
      .map((r) => ({ discordUserId: r.character.discordUserId, content: WENT_BLIND_DM })),
  };
}

module.exports = { runVisionDecayPass };
