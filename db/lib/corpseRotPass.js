// A person's corpse goes off (CORPSES.md). Three turns after death, "Ada's
// Corpse" becomes "Ada's Rotten Corpse" and starts stinking
// (bot/src/lib/deathSmell.js); monster corpses never rot. THIS RENAMES THE
// TAG ROW IN PLACE rather than expiring into a second one via
// Tag.expiresInto, because expiresInto names catalog SLUGS (this name is
// per-character), tagExpiryPass.js only walks CharacterTag (a corpse is
// usually a RoomTag), and a chain would leave the holding pointing at the OLD
// row — a body in your bag rots in your bag. IT MUST RUN BEFORE
// "expirySweep": that pass is a blind deleteMany over `expiresTurn <=
// turn.number`, so nulling expiresTurn here is what takes a rotted corpse out
// of its reach, no exemption list needed. Takes `prisma` as a parameter (db/lib/dm.js).
function rottenName(name) {
  return `${name}'s Rotten Corpse`;
}

function rottenDescription(name) {
  return `The rotten body of ${name}. It makes you sick to be near it.`;
}

// Same collision dance minting does: two characters can share a name (suffixed apart at death), so
// rotting both would collapse them onto one rotten name — the suffix is re-derived here since the
// old name is about to stop existing (see db/lib/corpseMint.js#createCorpseTag).
async function rotAndName(prisma, tag, who) {
  for (let attempt = 0; attempt < 6; attempt += 1) {
    const name = attempt ? `${rottenName(who)} (${attempt + 1})` : rottenName(who);
    try {
      await prisma.$transaction(async (tx) => {
        await tx.tag.update({
          where: { id: tag.id },
          data: {
            name,
            description: rottenDescription(who),
            corpseKind: "ROTTEN",
            defaultDurationTurns: null, // nulling holdings' clocks below is what takes this out of the blind sweep's reach
          },
        });
        await tx.characterTag.updateMany({ where: { tagId: tag.id }, data: { expiresTurn: null } });
        await tx.roomTag.updateMany({ where: { tagId: tag.id }, data: { expiresTurn: null } });
      });
      return name;
    } catch (err) {
      if (err?.code !== "P2002") throw err;
    }
  }
  throw new Error(`could not find a free rotten name for "${who}"`);
}

async function runCorpseRotPass(prisma, turn) {
  // A monster corpse has no defaultDurationTurns and a null expiresTurn, so it never matches either half.
  const due = await prisma.tag.findMany({
    where: {
      corpseKind: "FRESH",
      corpseOfCharacterId: { not: null },
      OR: [
        { characters: { some: { expiresTurn: { lte: turn.number } } } },
        { roomTags: { some: { expiresTurn: { lte: turn.number } } } },
      ],
    },
    select: { id: true, name: true, corpseOf: { select: { name: true } } },
  });

  // An object, not null: db/index.js reads null as "this pass failed, retry next advance".
  if (due.length === 0) return { turnNumber: turn.number, rotted: 0 };

  const rotted = [];
  for (const tag of due) {
    // The character's own name, not a substring of the tag's (the suffix makes parsing wrong).
    // A hard-deleted character leaves corpseOf null; fall back to rewriting what the tag already says.
    const who = tag.corpseOf?.name ?? tag.name.replace(/'s Corpse.*$/, "");
    try {
      const name = await rotAndName(prisma, tag, who);
      rotted.push(name);
    } catch (err) {
      console.error(`corpseRot: failed to rot tag ${tag.id}:`, err); // one bad row costs one body, not the pass
    }
  }

  return { turnNumber: turn.number, rotted: rotted.length, names: rotted };
}

module.exports = { runCorpseRotPass, rottenName, rottenDescription };
