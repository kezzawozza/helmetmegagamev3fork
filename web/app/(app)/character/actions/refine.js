"use server";

// The Godard Factory's Refine button (db/lib/refinery.js — read its header first, it's the
// whole rulebook this action enforces). Modelled on ./soilery.js, the closest existing analog:
// a Location-attribute-gated action with its own refusal chain, filed as a Move that commits
// now and resolves at the turn push (db/lib/moveEffects.js's `refined` entry).
//
// This used to be a Labor filed while standing on the floor — there was no Refine button, and
// db/lib/refinery.js was reachable only through the LABOR move kind. Laboring is gone, so the
// shift is its own verb now.
import { prisma } from "@lifeweb/db";
import { UserError } from "@/lib/actionResult";
import { getOpenTurn } from "@/lib/turn";
import { blockerFor, ACT } from "@lifeweb/db/lib/incapacitation";
import { isRefinery, refineryInput } from "@lifeweb/db/lib/refinery";
import { AUTO_REFINE_NOTE } from "@lifeweb/db/lib/constants";
import { requireFreeMove, fileAutoRoutine } from "@/lib/moveSpend";
import { logAudit } from "@/lib/requests";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { requireCharacter, revalidateAll, lockCharacter } from "./shared.js";

export async function refineRequestImpl() {
  const { session, character } = await requireCharacter();

  const location = character.locationId
    ? await prisma.location.findUnique({
        where: { id: character.locationId },
        select: { id: true, name: true, attributes: true },
      })
    : null;
  if (!isRefinery(location)) {
    throw new UserError("There's nothing to refine here.");
  }

  // Bound, Dying, Paralyzed, Catatonic — mirrors extractGodfleshRequestImpl's gate (misc.js).
  const blocker = blockerFor(character.tags, ACT);
  if (blocker) {
    throw new UserError(`You're in no state to work — you're ${blocker.name}.`);
  }

  // Godflesh in the worker's own hands OR in any Room stash here they can enter. Checked before
  // the Move is spent so a bare floor costs nobody their day; applyRefinery re-checks under the
  // transaction at the push, and says so in the close DM when somebody else's shift took the
  // last lump first.
  const input = await refineryInput(prisma, { id: character.id, locationId: character.locationId });
  if (!input) {
    throw new UserError("There's no Godflesh here to refine.");
  }

  const openTurn = await getOpenTurn();
  await requireFreeMove(character, openTurn);

  await prisma.$transaction(async (tx) => {
    await lockCharacter(tx, character.id);

    // Commits the Move now — the day is spent — but defers the cubes to the turn push
    // (db/lib/moveEffects.js's `refined` entry), exactly like Farm. The marker is what that
    // entry reads to know this was a refining shift.
    const action = await fileAutoRoutine(
      tx,
      character,
      openTurn,
      "Refining Godflesh on the Factory floor.",
      AUTO_REFINE_NOTE,
      null,
      { deferEffects: true },
    );

    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_refine",
      targetCharacterId: character.id,
      turnId: openTurn.id,
      details: { locationName: location?.name ?? null, actionId: action.id, source: input.kind },
    });
  });

  await afterInventoryChange([character.id]);
  revalidateAll();

  return {
    line: "You spent the day on the floor. The cubes come off the line when the turn closes.",
  };
}
