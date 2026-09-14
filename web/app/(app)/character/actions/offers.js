// Learn/Teach, Confess, Kiss — the three offer/consent handshakes and the
// lesson-offer helper they share.

import { after } from "next/server";
import { prisma } from "@lifeweb/db";
import { getOpenTurn } from "@/lib/turn";
import { UserError } from "@/lib/actionResult";
import { notHereMessage } from "@/lib/peopleHere";
import { createLessonOffer } from "@lifeweb/db/lib/lessons";
import { createConfessionOffer } from "@lifeweb/db/lib/confession";
import {
  createKissOffer,
  KISS_SELECT,
} from "@lifeweb/db/lib/kiss";
import { sendDm } from "@/lib/discordGuild";
import { ACT } from "@lifeweb/db/lib/incapacitation";
import {
  requireCharacter,
  revalidateAll,
} from "./shared.js";

// --- Lessons (docs/systemdocs/LESSONS.md) ------------------------------

// Learn and Teach are the same offer from opposite ends: initiator's Move
// checked now, both sides' when accepted. Nothing filed until then.
async function lessonOfferImpl({ teacherId, learnerId, tagId }) {
  const { session, character } = await requireCharacter();
  const offer = await createLessonOffer(prisma, {
    initiatorId: character.id,
    teacherId,
    learnerId,
    tagId,
  });
  if (!offer.ok) throw new UserError(offer.reason);
  after(() =>
    sendDm(offer.dm.discordUserId, offer.dm.content, {
      components: offer.dm.components,
      meta: offer.dm.meta,
      source: "player_event",
    }).catch((err) =>
      console.error(`Lesson offer DM for ${offer.offer.id} failed:`, err),
    ),
  );
  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_lesson_offer",
      targetCharacterId: offer.offer.responderId,
      details: { offerId: offer.offer.id, teacherId, learnerId, tagId },
    },
  });
  revalidateAll();
  return { pending: true };
}

export async function learnRequestImpl({ teacherId, tagId }) {
  const { character } = await requireCharacter({ needs: ACT });
  return lessonOfferImpl({ teacherId, learnerId: character.id, tagId });
}

export async function teachRequestImpl({ learnerId, tagId }) {
  const { character } = await requireCharacter({ needs: ACT });
  return lessonOfferImpl({ teacherId: character.id, learnerId, tagId });
}

// --- Confession (docs/systemdocs/CONFESSION.md) --------------------------

// Only the penitent has a door — the acting character is always the one
// confessing, from the session, never the posted body. `chaplainId`/`tagId` re-validated inside createConfessionOffer.
export async function confessRequestImpl({ chaplainId, tagId }) {
  const { session, character } = await requireCharacter({ needs: ACT });
  const offer = await createConfessionOffer(prisma, {
    penitentId: character.id,
    chaplainId,
    tagId,
  });
  if (!offer.ok) throw new UserError(offer.reason);
  after(() =>
    sendDm(offer.dm.discordUserId, offer.dm.content, {
      components: offer.dm.components,
      meta: offer.dm.meta,
      source: "player_event",
    }).catch((err) =>
      console.error(`Confession offer DM for ${offer.offer.id} failed:`, err),
    ),
  );
  // The audit row DOES name the tag — the chaplain is kept in the dark, not the host.
  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_confession_offer",
      targetCharacterId: offer.offer.responderId,
      details: {
        offerId: offer.offer.id,
        chaplainId,
        penitentId: character.id,
        tagId,
      },
    },
  });
  revalidateAll();
  return { pending: true };
}

// --- Kiss (docs/systemdocs/KISS.md) --------------------------------------

// The one door. Every gate lives in db/lib/kiss.js#kissAuthority so the
// picker, this action and the Accept click all refuse for the same reasons;
// createKissOffer re-runs it rather than trusting the posted body. Acting
// character comes from the session, never a posted id. No Move spent, no
// Action filed — held back only by the 2-hour cooldown in createKissOffer
// and the once-a-turn mood ration on the far side of Accept.
export async function kissRequestImpl({ targetCharacterId }) {
  const { character } = await requireCharacter({ needs: ACT });

  const target = await prisma.character.findFirst({
    where: { id: targetCharacterId ?? "", status: "ALIVE" },
    select: KISS_SELECT,
  });
  if (!target) throw new UserError(notHereMessage(target));

  const openTurn = await getOpenTurn();
  if (!openTurn) throw new UserError("No turn is open.");

  const offer = await createKissOffer(prisma, { actor: character, target, turn: openTurn });
  if (!offer.ok) throw new UserError(offer.reason);

  after(() =>
    sendDm(offer.dm.discordUserId, offer.dm.content, {
      components: offer.dm.components,
      meta: offer.dm.meta,
      source: "player_event",
    }).catch((err) => console.error(`Kiss offer DM to ${target.id} failed:`, err)),
  );

  // No audit row here on purpose — createKissOffer writes it in the same
  // transaction as the Offer, since that row IS the two-hour cooldown (db/lib/kiss.js#kissCooldownLeft).
  revalidateAll();
  return { pending: true };
}

