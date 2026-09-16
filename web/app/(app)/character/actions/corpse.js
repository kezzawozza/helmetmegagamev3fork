// Bodies: Butcher, Bury, Engrave, Mutilate.

import { after } from "next/server";
import { prisma } from "@lifeweb/db";
import { resolveTargetKey } from "@lifeweb/db/lib/targetKey";
import { getOpenTurn } from "@/lib/turn";
import { logAudit } from "@/lib/requests";
import { UserError } from "@/lib/actionResult";
import { expiryForGrant } from "@lifeweb/db/lib/grantExpiry";
import {
  requireFreeMove,
  fileAutoRoutine,
} from "@/lib/moveSpend";
import {
  addToStack,
  debitResources,
  dropCharacterTag,
} from "@/lib/tagEffects";
import {
  isHere,
  notHereMessage,
} from "@/lib/peopleHere";
import { isBound as isBoundTarget } from "@lifeweb/db/lib/bind";
import {
  killCharacter,
} from "@/lib/discordGuild";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { announceInRoom } from "@lifeweb/db/lib/roomAnnounce";
import { corpsesInReach } from "@lifeweb/db/lib/corpses";
import {
  partFor,
  resolveMutilation,
  harvestableOrgans,
} from "@lifeweb/db/lib/mutilate";
import { mintHeadstone } from "@lifeweb/db/lib/headstone";
import { dropRoomTag } from "@lifeweb/db/lib/tagWrites";
import {
  BUTCHER_SLUG,
  ENGRAVE_RESOURCE_COST,
  MUTILATE_GATE_SLUGS,
} from "@lifeweb/db/lib/constants";
import { ambientLine } from "@lifeweb/db/lib/ambientLine";
import { notifyCharacter } from "@/lib/notifyCharacter";
import { ACT } from "@lifeweb/db/lib/incapacitation";
import { applyMood } from "@lifeweb/db/lib/mood";
import {
  FULL_NAME_LIMIT,
  matchesTypedName,
} from "@/lib/characterName";
import {
  requireCharacter,
  revalidateAll,
  speakAtSite,
} from "./shared.js";

// --- Bodies: Butcher, Bury, Engrave --------------------------------------
// All three act on a CORPSE TAG rather than a typed name (docs/systemdocs/CORPSES.md): a body is an object you hold
// or can walk up to. Engrave is the deliberate exception — see its own comment.

// Shared reach rule: a corpse in your own hands, or one lying in a Room at your Location you can get into
// (Location-grain, CARRY.md §5). Re-resolved server-side from posted ids every time — the dialog's list is advisory.
async function resolveCorpseSource(character, { tagId, sourceKey }) {
  const reachable = await corpsesInReach(prisma, character);
  const found = reachable.find(
    (c) => c.tagId === tagId && c.sourceKey === sourceKey,
  );
  // One message for both "you made that up" and "someone got there first" — telling them apart would leak whether a body they can't see exists.
  if (!found) throw new UserError("That body isn't there any more.");
  return found;
}

// Conditional write IS the check in both branches — a room is a multi-actor inventory (CARRY.md §5), and two of your own tabs can race just as well.
async function takeCorpse(tx, corpse) {
  if (corpse.source.kind === "room") {
    const { ok } = await dropRoomTag(tx, corpse.source.id, corpse.tagId, 1);
    if (!ok) throw new UserError("That body isn't there any more.");
    return;
  }
  const gone = await tx.characterTag.deleteMany({
    where: { characterId: corpse.source.id, tagId: corpse.tagId },
  });
  if (gone.count === 0)
    throw new UserError("That body isn't there any more.");
}

// Butchering. FREE — no ⬢, no Move — and consumes the body. Deliberately does NOT free the soul: no burial means the
// player stays Cursed. Engrave exists to fill that hole.
export async function butcherCorpseRequestImpl({
  tagId,
  sourceKey,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });

  // The gate, re-checked here because a disabled button is a hint, not a lock.
  if (!character.tags.some((ct) => ct.tag?.slug === BUTCHER_SLUG)) {
    throw new UserError("You don't know how to butcher.");
  }

  const corpse = await resolveCorpseSource(character, { tagId, sourceKey });
  const yieldTag = await prisma.tag.findUnique({
    where: { slug: corpse.yieldSlug },
  });
  // A catalog out of step with the code — refuse rather than silently grant nothing, which would read as a broken button.
  if (!yieldTag) throw new UserError("Nothing comes of that one. Tell a GM.");

  const openTurn = await getOpenTurn();
  const expiresTurn = await expiryForGrant(prisma, yieldTag, openTurn, {
    reason: "butcher",
  });

  // A human body also gives up whatever Mutilate hasn't already taken — every ladder run to its end in one pass instead of nine presses.
  let subject = null;
  let harvests = [];
  let organTagBySlug = new Map();
  let organExpiryByTagId = new Map();
  if (corpse.human && corpse.deadCharacterId) {
    subject = await prisma.character.findUnique({
      where: { id: corpse.deadCharacterId },
      select: { id: true, tags: { select: { tag: { select: { slug: true } } } } },
    });
    const rawHarvests = harvestableOrgans(
      (subject?.tags ?? []).map((ct) => ct.tag.slug),
    );
    if (rawHarvests.length) {
      const neededSlugs = new Set();
      for (const h of rawHarvests) {
        neededSlugs.add(h.grantSlug);
        neededSlugs.add(h.itemSlug);
        if (h.dropSlug) neededSlugs.add(h.dropSlug);
      }
      const organTags = await prisma.tag.findMany({
        where: { slug: { in: [...neededSlugs] } },
      });
      organTagBySlug = new Map(organTags.map((t) => [t.slug, t]));
      // A harvest whose tags aren't all in the catalog is dropped rather than blocking Butcher — human-flesh must not fail on catalog drift; organs are the bonus.
      harvests = rawHarvests.filter(
        (h) =>
          organTagBySlug.has(h.grantSlug) &&
          organTagBySlug.has(h.itemSlug) &&
          (!h.dropSlug || organTagBySlug.has(h.dropSlug)),
      );
      const itemTags = [...new Set(harvests.map((h) => h.itemSlug))].map(
        (slug) => organTagBySlug.get(slug),
      );
      const expiries = await Promise.all(
        itemTags.map((tag) =>
          expiryForGrant(prisma, tag, openTurn, {
            characterId: character.id,
            where: "butcher",
          }),
        ),
      );
      organExpiryByTagId = new Map(itemTags.map((tag, i) => [tag.id, expiries[i]]));
    }
  }

  await prisma.$transaction(async (tx) => {
    await takeCorpse(tx, corpse);
    await addToStack(tx, character.id, yieldTag.id, 1, {
      source: "EVENT",
      expiresTurn,
      stackable: yieldTag.stackable,
    });
    for (const h of harvests) {
      const grantTag = organTagBySlug.get(h.grantSlug);
      const itemTag = organTagBySlug.get(h.itemSlug);
      const dropTag = h.dropSlug ? organTagBySlug.get(h.dropSlug) : null;
      if (subject) {
        if (dropTag) await dropCharacterTag(tx, subject.id, dropTag.id);
        await addToStack(tx, subject.id, grantTag.id, 1, {
          source: "EVENT",
          stackable: grantTag.stackable,
        });
      }
      await addToStack(tx, character.id, itemTag.id, h.quantity, {
        source: "EVENT",
        expiresTurn: organExpiryByTagId.get(itemTag.id),
        stackable: itemTag.stackable,
      });
    }
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_butcher_corpse",
      targetCharacterId: corpse.deadCharacterId ?? character.id,
      details: {
        corpse: corpse.tagName,
        made: yieldTag.name,
        source: corpse.source.kind,
        ...(harvests.length
          ? { organs: harvests.map((h) => ({ part: h.part, quantity: h.quantity })) }
          : {}),
      },
    });
  });

  await afterInventoryChange([character.id]);

  // The dead player is told, never told by whom — the posture every request acting on someone else takes.
  if (corpse.human && corpse.deadCharacterId) {
    const dead = await prisma.character.findUnique({
      where: { id: corpse.deadCharacterId },
    });
    if (dead) notifyCharacter(dead, "Somebody has cut your body apart.");
  }
  // A public room's contents changing is public by nature (CARRY.md §6).
  if (corpse.source.kind === "room") {
    after(() =>
      announceInRoom(corpse.source, character, "butchers a body here."),
    );
  }

  revalidateAll();
  return { made: yieldTag.name };
}

// Mutilating. One piece off a bound person or a corpse, FREE — no ⬢, no Move, no turn. Press again for the next
// piece; db/lib/mutilate.js's ladder is what stops a third eye. Deliberately does NOT consume the body like Butcher
// does — this is picking at one, so you can come back for the other eye. The part menu is UNFILTERED client-side on
// purpose: filtering to what's left would answer "what are they already missing?" to anyone who opened it — the refusal here is where they find out.
export async function mutilateRequestImpl({
  targetCharacterId,
  tagId,
  sourceKey,
  part,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });

  if (!character.locationId)
    throw new UserError("You aren't anywhere you could do that.");
  // Re-checked here and not merely in the UI: the hidden button is a hint.
  const actorSlugs = character.tags.map((ct) => ct.tag.slug);
  if (!actorSlugs.some((slug) => MUTILATE_GATE_SLUGS.includes(slug)))
    throw new UserError("You couldn't bring yourself to.");

  const named = partFor(part);
  if (!named) throw new UserError("That isn't something you could take.");

  // Two subjects, one action: a corpse resolves through the reach rule Butcher/Bury share; a living person through
  // the Bound-and-here check Torture makes. Either way it's ONE Character row to injure, so everything below is common.
  let corpse = null;
  let subject = null;
  if (tagId) {
    corpse = await resolveCorpseSource(character, { tagId, sourceKey });
    // A Nekker has no sheet to injure and nothing recognisable to take.
    if (!corpse.human || !corpse.deadCharacterId)
      throw new UserError("There's nothing in that one you'd want.");
    subject = await prisma.character.findUnique({
      where: { id: corpse.deadCharacterId },
      include: { tags: { include: { tag: { select: { slug: true } } } } },
    });
    if (!subject) throw new UserError("That body isn't there any more.");
  } else {
    // A KEY, not an id — somebody in a mask is listed by token (db/lib/targetKey.js). You can cut a
    // piece off a man whose name you never learned, and a tied-up stranger is exactly that case.
    const targetId = await resolveTargetKey(prisma, character, targetCharacterId);
    if (targetId === character.id)
      throw new UserError("You can't do that to yourself.");
    // The WHOLE row, not a select: a lethal part hands this to killCharacter, which needs discordRoleId and
    // everything revokeAllCharacterAccess needs — a partial row here orphans a Discord role.
    subject = await prisma.character.findFirst({
      where: { id: targetId ?? "", status: "ALIVE" },
      include: { tags: { include: { tag: { select: { slug: true } } } } },
    });
    if (!subject || !isHere(character, subject, { allowConcealed: true }))
      throw new UserError(notHereMessage(subject));
    if (!isBoundTarget(subject))
      throw new UserError(`${subject.name} isn't tied up.`);
  }

  const step = resolveMutilation(
    part,
    subject.tags.map((ct) => ct.tag.slug),
  );
  if (!step)
    throw new UserError(`There's no ${named.label.toLowerCase()} left to take.`);

  const [grantTag, itemTag] = await Promise.all([
    prisma.tag.findUnique({ where: { slug: step.grantSlug } }),
    prisma.tag.findUnique({ where: { slug: step.itemSlug } }),
  ]);
  // A catalog out of step with the code — refuse rather than silently grant nothing, which would read as a broken button.
  if (!grantTag || !itemTag)
    throw new UserError("Nothing comes of that one. Tell a GM.");
  const dropTag = step.dropSlug
    ? await prisma.tag.findUnique({ where: { slug: step.dropSlug } })
    : null;

  const openTurn = await getOpenTurn();
  const expiresTurn = await expiryForGrant(prisma, itemTag, openTurn, {
    characterId: character.id,
    where: "mutilate",
  });
  // The organs kill, but only somebody who is still using them.
  const kills = step.lethal && subject.status === "ALIVE";

  await prisma.$transaction(async (tx) => {
    if (dropTag) await dropCharacterTag(tx, subject.id, dropTag.id);
    await addToStack(tx, subject.id, grantTag.id, 1, {
      source: "EVENT",
      stackable: grantTag.stackable,
    });
    await addToStack(tx, character.id, itemTag.id, 1, {
      source: "EVENT",
      expiresTurn,
      stackable: itemTag.stackable,
    });
    // A corpse feels nothing. applyMood on a dead row would move a dial
    // nobody reads and show up in the mood log as a live event.
    if (subject.status === "ALIVE")
      await applyMood(tx, subject.id, { kind: "MUTILATED" });
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_mutilate",
      targetCharacterId: subject.id,
      turnId: openTurn?.id ?? null,
      details: {
        subjectName: subject.name,
        part: step.part,
        granted: grantTag.name,
        dropped: dropTag?.name ?? null,
        item: itemTag.name,
        lethal: kills,
        source: corpse ? corpse.source.kind : "person",
        ...(corpse ? { corpse: corpse.tagName } : {}),
      },
    });
  });

  await afterInventoryChange([character.id, subject.id]);

  // Unattributed, like every other request that acts on somebody else. The
  // death DM rides on killCharacter so nothing ever sends two.
  if (kills) {
    await killCharacter(subject, `Your ${named.label.toLowerCase()} was cut out.`).catch(
      (err) =>
        console.error(`Failed to kill mutilated character ${subject.id}:`, err),
    );
  } else if (corpse) {
    notifyCharacter(subject, "Somebody has been cutting pieces off your body.");
  } else {
    notifyCharacter(subject, `Somebody cut off your ${named.label.toLowerCase()}.`);
  }

  // A public room's contents changing is public by nature (CARRY.md §6). Said
  // vaguely on purpose — the room learns a body was cut, not what came off it.
  if (corpse && corpse.source.kind === "room") {
    after(() =>
      announceInRoom(corpse.source, character, "cuts something off a body here."),
    );
  }

  revalidateAll();
  return { part: named.label, name: subject.name };
}

// Scenery into the Location the actor is standing in. `requireCharacter` carries no `character.location`, so the channel is read here.
async function speakHere(character, text) {
  if (!character.locationId) return;
  const location = await prisma.location.findUnique({
    where: { id: character.locationId },
    select: { discordChannelId: true },
  });
  speakAtSite(location?.discordChannelId, ambientLine(text));
}

// Burying. Takes the body — you have to actually have it, or be able to reach it — and spends your Move.
export async function buryCharacterRequestImpl({
  tagId,
  sourceKey,
}) {
  const { session, character } = await requireCharacter();

  const corpse = await resolveCorpseSource(character, { tagId, sourceKey });
  if (!corpse.human || !corpse.deadCharacterId) {
    throw new UserError("There's no soul in that one.");
  }
  const target = await prisma.character.findUnique({
    where: { id: corpse.deadCharacterId },
  });
  if (!target) throw new UserError("There's nobody left to bury.");
  if (target.buriedAt) throw new UserError("They're already in the ground.");

  const openTurn = await getOpenTurn();
  await requireFreeMove(character, openTurn);
  const buriedAt = new Date();

  await prisma.$transaction(async (tx) => {
    await takeCorpse(tx, corpse);
    await tx.character.update({ where: { id: target.id }, data: { buriedAt } });
    const action = await fileAutoRoutine(
      tx,
      character,
      openTurn,
      `Buried ${target.name}.`,
      "auto:bury",
    );
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_bury_character",
      targetCharacterId: target.id,
      details: { zoneId: character.zoneId, corpse: corpse.tagName },
    });
  });

  // NOTHING to revoke here. Burial lifts the CURSE — the re-roll penalty, which db/lib/curse.js
  // derives from `buriedAt` with no write of its own — and leaves the watching seat alone.
  // db/lib/ghost.js ends that only when a living character is theirs again. The two used to be one
  // predicate, so burying somebody also threw them out of the game they were still watching.
  await afterInventoryChange([character.id]);

  notifyCharacter(target, "Your body was buried. The curse has lifted. You are still watching.");
  if (corpse.source.kind === "room") {
    after(() => announceInRoom(corpse.source, character, "takes a body away."));
  }
  await speakHere(character, `${target.name} was buried.`);

  revalidateAll();
  return { name: target.name };
}

// Engraving. The answer to a body nobody can find — the ONE action here with no corpse/reach check, searching the
// whole game rather than your zone. Name is typed, not a dropdown: a dropdown would answer "who is dead?" to anyone
// who opened it, over every corpse in Ravenheart. matchesTypedName matches the full display name or plain First
// Last, so an honorific nobody told them about isn't a wall. The >1-match refusal means exactly that: two dead people with the same full name — the only thing standing between a mourner and freeing the wrong soul.
export async function engraveHeadstoneRequestImpl({
  name: rawName,
}) {
  const { session, character } = await requireCharacter({ needs: ACT });

  const typed = rawName?.toString().trim().slice(0, FULL_NAME_LIMIT) ?? "";
  if (!typed) throw new UserError("Whose name?");

  // No zone clause, on purpose (see above). The composed name isn't something Prisma can compare against, so the unburied dead (a short list) come back and matchesTypedName does the rest.
  const candidates = await prisma.character.findMany({
    where: { status: "DEAD", buriedAt: null },
  });
  const matches = candidates.filter((c) => matchesTypedName(c, typed));
  if (matches.length === 0)
    throw new UserError("Nobody by that name is dead and unburied.");
  if (matches.length > 1) {
    throw new UserError(
      "More than one dead person answers to that name. A GM will have to do it.",
    );
  }
  const target = matches[0];

  // The friendly refusal. The real check is the conditional debit below, which
  // is what actually stops the balance going negative.
  if (character.resources < ENGRAVE_RESOURCE_COST) {
    throw new UserError(`Engraving costs ${ENGRAVE_RESOURCE_COST} ⬢.`);
  }

  const openTurn = await getOpenTurn();
  await requireFreeMove(character, openTurn);
  const buriedAt = new Date();

  const result = await prisma.$transaction(async (tx) => {
    // The conditional debit, which is the check that actually holds — the
    // friendly refusal above only makes the message better.
    await debitResources(
      tx,
      { kind: "character", id: character.id, name: character.name },
      ENGRAVE_RESOURCE_COST,
    );
    await tx.character.update({ where: { id: target.id }, data: { buriedAt } });
    const headstone = await mintHeadstone(tx, target);
    await addToStack(tx, character.id, headstone.id, 1, {
      source: "EVENT",
      expiresTurn: null,
      stackable: false,
    });
    const action = await fileAutoRoutine(
      tx,
      character,
      openTurn,
      `Engraved a headstone for ${target.name}.`,
      "auto:engrave",
    );
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_engrave_headstone",
      targetCharacterId: target.id,
      details: { spent: ENGRAVE_RESOURCE_COST },
    });
    return { headstone };
  });

  // Same as Bury above: the curse lifts, the seat does not. See db/lib/ghost.js.
  await afterInventoryChange([character.id]);

  notifyCharacter(
    target,
    "Somebody carved your name in stone. The curse has lifted. You are still watching.",
  );
  await speakHere(character, `A headstone was engraved for ${target.name}.`);

  revalidateAll();
  return { name: target.name, headstone: result.headstone.name };
}

