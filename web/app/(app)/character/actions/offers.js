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

// Learn and Teach are the same offer from opposite ends: the initiator's
// Move slot is checked now, both sides' when the other accepts. Nothing is
// filed until then — the offer row and one DM with two buttons.
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

// Only the penitent has a door. The acting character is always the one
// confessing — taken from the session, never from the posted body — so there
// is no way to file a confession on somebody else's behalf, and no chaplain
// half of this to write. `chaplainId` and `tagId` are re-validated inside
// createConfessionOffer against the penitent's own row.
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
  // The audit row DOES name the tag. A GM has to be able to see what was
  // asked for; the chaplain is the one kept in the dark, not the host.
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

// The one door. Every gate lives in db/lib/kiss.js#kissAuthority so the picker
// on the sheet, this action, and the Accept click a day later all refuse for
// the same reasons — and createKissOffer re-runs it rather than trusting
// anything that arrived in the body.
//
// The acting character comes from the session, never from a posted id, so
// there is no way to file a kiss on somebody else's behalf.
//
// No Move is spent and no Action row is filed. What holds it back is the
// 2-hour cooldown inside createKissOffer and the once-a-turn mood ration on
// the other side of Accept.
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

  // No audit row here on purpose. createKissOffer writes it inside the same
  // transaction as the Offer, because that row IS the two-hour cooldown
  // (db/lib/kiss.js#kissCooldownLeft) — a second one written here would just
  // be a duplicate, and leaving it to each caller is how a cooldown quietly
  // stops existing for whichever caller forgets.
  revalidateAll();
  return { pending: true };
}

