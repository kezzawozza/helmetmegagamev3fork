// Learn/Teach, Confess, Kiss, Search — the offer/consent handshakes and the
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
import { createSearchOffer, SEARCH_SELECT } from "@lifeweb/db/lib/search";
import { resolveTargetKey } from "@lifeweb/db/lib/targetKey";
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

// The partner arrives as a TARGET KEY — "character:<id>" or "hood:<token>" —
// because a lesson is two people standing next to each other and a mask does not
// stop one being given. resolveTargetKey re-checks co-presence for a token and
// answers null for anybody who has walked off, which createLessonOffer then
// refuses the same way it refuses a made-up id.
async function partnerIdFrom(character, key) {
  const id = await resolveTargetKey(prisma, character, key);
  if (!id) throw new UserError("They aren't here.");
  return id;
}

export async function learnRequestImpl({ teacherId, tagId }) {
  const { character } = await requireCharacter({ needs: ACT });
  return lessonOfferImpl({ teacherId: await partnerIdFrom(character, teacherId), learnerId: character.id, tagId });
}

export async function teachRequestImpl({ learnerId, tagId }) {
  const { character } = await requireCharacter({ needs: ACT });
  return lessonOfferImpl({ teacherId: character.id, learnerId: await partnerIdFrom(character, learnerId), tagId });
}

// --- Confession (docs/systemdocs/CONFESSION.md) --------------------------

// Only the penitent has a door — the acting character is always the one
// confessing, from the session, never the posted body. `chaplainId`/`tagId` re-validated inside createConfessionOffer.
export async function confessRequestImpl({ chaplainId, tagId }) {
  const { session, character } = await requireCharacter({ needs: ACT });
  // A confessional is built so neither side sees the other, so a hooded chaplain
  // is if anything the point — hence a target key rather than a bare id.
  const chaplainRealId = await partnerIdFrom(character, chaplainId);
  const offer = await createConfessionOffer(prisma, {
    penitentId: character.id,
    chaplainId: chaplainRealId,
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

  // A target key like every other people-picker. In practice kissAuthority will
  // refuse a hood anyway — a covered face is one of the things it blocks — but
  // the key is what every roster posts now, and a verb that could not parse one
  // would refuse with "they aren't here" about somebody standing right there.
  const targetId = await resolveTargetKey(prisma, character, targetCharacterId);
  const target = targetId
    ? await prisma.character.findFirst({
        where: { id: targetId, status: "ALIVE" },
        select: KISS_SELECT,
      })
    : null;
  if (!target) throw new UserError("They aren't here.");

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

// --- Search (docs/systemdocs/SEARCH.md) ----------------------------------

// The one door, the Kiss shape. Every gate lives in
// db/lib/search.js#searchAuthority so the picker, this action and the Yes
// click all refuse for the same reasons, and createSearchOffer re-runs it on
// whatever is posted rather than trusting the body. Acting character comes
// from the session, never a posted id.
//
// `targetKey` rather than a bare id, because Search is the second verb in the
// game that can reach somebody in a hood (Transfer is the first): a concealed
// row arrives as "hood:<token>" and only resolveHoodToken can turn it into an
// id — and only for somebody actually standing here, which is what stops the
// token being a roster oracle.
export async function searchRequestImpl({ targetKey }) {
  const { character } = await requireCharacter({ needs: ACT });

  // One resolver for every verb (db/lib/targetKey.js) — this used to unwrap the
  // key by hand, which is the drift that module exists to stop.
  const targetId = await resolveTargetKey(prisma, character, targetKey);

  const target = targetId
    ? await prisma.character.findFirst({
        where: { id: targetId, status: "ALIVE" },
        select: SEARCH_SELECT,
      })
    : null;
  if (!target) throw new UserError(notHereMessage(target));

  const openTurn = await getOpenTurn();
  if (!openTurn) throw new UserError("No turn is open.");

  const offer = await createSearchOffer(prisma, { actor: character, target, turn: openTurn });
  if (!offer.ok) throw new UserError(offer.reason);

  after(() =>
    sendDm(offer.dm.discordUserId, offer.dm.content, {
      components: offer.dm.components,
      meta: offer.dm.meta,
      source: "player_event",
    }).catch((err) => console.error(`Search offer DM to ${target.id} failed:`, err)),
  );

  // No audit row here: createSearchOffer writes it in the same transaction as
  // the Offer and the SearchAttempt that IS the ration (SEARCH.md §3).
  revalidateAll();
  return { pending: true };
}
