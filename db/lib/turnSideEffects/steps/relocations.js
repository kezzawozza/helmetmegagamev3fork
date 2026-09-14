const { sendDm } = require("../../dm");
const { DM_KIND } = require("../../dmKinds");
const { applyLocationMoveSideEffects } = require("../../locationMove");
const { rollCavingOnArrival } = require("../../cavingPass");

// Two kinds of relocation land in the same breath and want the identical
// Discord work: a GM's staged "Relocate to" (zoneMoves) and a player's
// paid crossing finally arriving (travelArrivals, MAP.md §3).
async function applyRelocations({ prisma, p, list, step }) {
  const relocations = [...list(p.zoneMoves), ...list(p.travelArrivals)];
  for (let i = 0; i < relocations.length; i += 1) {
    const move = relocations[i];
    await step(`move:${i}`, async () => {
      await applyLocationMoveSideEffects(prisma, move).catch((err) =>
        console.error(`Relocation side effects failed for ${move.characterId}:`, err),
      );

      // The traveller pressed Confirm a turn ago and has heard nothing since,
      // so arriving is the one thing that has to be told. A dragged corpse
      // gets no letter; `alive` is only set by the travel pass.
      if (move.toLocationName && move.alive && move.discordUserId) {
        await sendDm(
          prisma,
          move.discordUserId,
          `You arrive at **${move.toLocationName}**.`,
          { kind: DM_KIND.QUIET },
        ).catch((err) =>
          console.error(`Arrival DM to ${move.discordUserId} failed:`, err),
        );
      }

      // The Caving Die, for a GM's staged "Relocate to". It could not run
      // inside applyOneStagedEffect — rollCaving opens its own transaction and
      // that function is already in one — but out here the write has committed
      // and this is the same post-commit half every other DM goes out from.
      //
      // It has to happen SOMEWHERE, and this is the only place left: the
      // turn-start pass used to sweep up anyone a GM had dropped underground,
      // and with that pass gone a staged relocation into the Depths would
      // otherwise roll nothing at all until the character walked. Being
      // *dropped* into the dark being the one free walk in is exactly how the
      // die first looked broken (CAVING.md §2).
      const landed = move.toLocationId
        ? await prisma.location
            .findUnique({ where: { id: move.toLocationId }, include: { zone: true } })
            .catch(() => null)
        : null;
      if (landed && move.alive !== false) {
        const dm = await rollCavingOnArrival(
          prisma,
          { id: move.characterId, discordUserId: move.discordUserId },
          landed,
        );
        if (dm) {
          await sendDm(prisma, dm.discordUserId, dm.content).catch((err) =>
            console.error(`Arrival caving DM to ${dm.discordUserId} failed:`, err),
          );
        }
      }
    });
  }
}

module.exports = { applyRelocations };
