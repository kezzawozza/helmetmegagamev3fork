"use server";

import { revalidatePath } from "next/cache";
import { TURNS_PATH } from "@/lib/routes";
import { redirect } from "next/navigation";
import {
  prisma,
  MORTUS_SLUG,
  DRAINED_SLUG,
  FORTRESS_SLUG,
  bloodValueForTags,
  bumpBlood,
  FEED_PERSON_AMOUNT,
} from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { getOpenTurn } from "@/lib/turn";
import { expiryForGrant } from "@lifeweb/db/lib/grantExpiry";
import { logAudit } from "@/lib/requests";
import { UserError, guarded } from "@/lib/actionResult";
import { notifyCharacter } from "@/lib/notifyCharacter";
import { killCharacter } from "@/lib/discordGuild";

// The Lifeweb's two player-facing Requests, same contract as the sheet's
// (web/app/(app)/character/requestActions.js): authenticate, re-validate,
// apply, write Request + AuditLog in ONE transaction. Both snapshot
// `bloodDelta` — what actually moved after the 0-100 clamp — since that is
// the only number an Undo can safely reverse (docs/systemdocs/REQUESTS.md §2).

// The /lifeweb gate is advisory — a server action is a public endpoint, so
// Mortus is re-checked here, plus standing in the Fortress (MAP.md §3).
async function requireMortusCharacter() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");

  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    include: { tags: { include: { tag: true } }, zone: { select: { slug: true } } },
  });
  if (!character) throw new UserError("You need a living character to do that.");
  if (!character.tags.some((ct) => ct.tag.slug === MORTUS_SLUG)) {
    throw new UserError("Only the Mortii may touch the Lifeweb.");
  }
  if (character.zone?.slug !== FORTRESS_SLUG) {
    throw new UserError("The Lifeweb is in the Fortress. You have to be standing there.");
  }
  return { session, character };
}

// The target has to be at the tower too — folded into the WHERE clause.
async function requireLivingTarget(targetCharacterId) {
  const target = await prisma.character.findFirst({
    // `?? ""` is load-bearing: Prisma strips an undefined field from a where
    // clause instead of matching nothing, so an omitted id must never turn
    // "bleed this person" into "bleed any living character".
    where: { id: targetCharacterId ?? "", status: "ALIVE", zone: { slug: FORTRESS_SLUG } },
    include: { tags: { include: { tag: true } } },
  });
  if (!target) throw new UserError("They aren't in the Fortress.");
  return target;
}

function revalidateAll() {
  revalidatePath("/lifeweb");
  revalidatePath("/character");
  revalidatePath("/gm/players", "layout");
  revalidatePath(TURNS_PATH, "page");
  revalidatePath("/gm/audit");
}

// Bleeding someone: the pool gains, and they carry Drained until it expires
// on its own via the turn sweep. Self-targeting is allowed — donating your
// own blood is the obvious reading of the button.
async function donateBloodRequestImpl({ targetCharacterId }) {
  const { session, character } = await requireMortusCharacter();
  const target = await requireLivingTarget(targetCharacterId);

  if (target.tags.some((ct) => ct.tag.slug === DRAINED_SLUG)) {
    throw new UserError(`${target.name} is already Drained.`);
  }

  const [openTurn, drainedTag] = await Promise.all([
    getOpenTurn(),
    prisma.tag.findUnique({ where: { slug: DRAINED_SLUG } }),
  ]);
  if (!drainedTag) throw new UserError("The Drained tag is missing — run npm run db:sync-tags.");

  const { amount, tier } = bloodValueForTags(target.tags);
  const expiresTurn = await expiryForGrant(prisma, drainedTag, openTurn, {
    characterId: target.id,
    where: "donateBloodRequest",
  });

  // `blood` must be produced INSIDE the transaction: it feeds the Undo
  // snapshot (REQUESTS.md §2) and must describe this statement's own move.
  let blood;
  await prisma.$transaction(async (tx) => {
    blood = await bumpBlood(tx, amount);
    await tx.characterTag.create({
      data: { characterId: target.id, tagId: drainedTag.id, source: "EVENT", expiresTurn },
    });

    const effect = {
      targetCharacterId: target.id,
      targetName: target.name,
      tier,
      nominalAmount: amount,
      bloodBefore: blood.before,
      bloodAfter: blood.after,
      bloodDelta: blood.delta,
      drainedTagId: drainedTag.id,
      expiresTurn,
    };
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_donate_blood",
      targetCharacterId: target.id,
      details: effect,
    });
  });

  // Self-donation needs no DM — a player already knows what they clicked.
  if (target.id !== character.id) notifyCharacter(target, "You've been Drained.");

  revalidateAll();
  return { targetName: target.name, amount: blood.delta, tier };
}

// Feeding someone to the Lifeweb kills them, here, on the click. The kill is
// claimed INSIDE the transaction moving the blood, with the same conditional
// `status: ALIVE` where-clause every death path uses (db/lib/characterDeath.js),
// so two Mortii feeding the same person can't both claim it. killCharacter()
// runs after commit — it must never hold the transaction open. Undo does not
// revive (REQUESTS.md §2): it only draws the blood back out.
async function feedPersonRequestImpl({ targetCharacterId }) {
  const { session, character } = await requireMortusCharacter();
  const target = await requireLivingTarget(targetCharacterId);

  const openTurn = await getOpenTurn();

  let blood;
  let killed = false;
  await prisma.$transaction(async (tx) => {
    blood = await bumpBlood(tx, FEED_PERSON_AMOUNT);

    // `count` is 0 when someone else got there first; blood still lands but the teardown below is skipped.
    const claim = await tx.character.updateMany({
      where: { id: target.id, status: "ALIVE" },
      data: { status: "DEAD" },
    });
    killed = claim.count > 0;

    const effect = {
      targetCharacterId: target.id,
      targetName: target.name,
      nominalAmount: FEED_PERSON_AMOUNT,
      bloodBefore: blood.before,
      bloodAfter: blood.after,
      bloodDelta: blood.delta,
      killed,
      killedAt: killed ? new Date().toISOString() : null,
    };
    await logAudit(tx, {
      actorDiscordUserId: session.discordUserId,
      actionType: "request_feed_person",
      targetCharacterId: target.id,
      details: effect,
    });
  });

  // Rest of death runs outside the transaction, row status already written.
  // Not awaited-and-thrown: a Discord hiccup must not report the feed as failed.
  if (killed) {
    await killCharacter(target, "You were fed to the Lifeweb.").catch((err) =>
      console.error(`killCharacter failed after feeding ${target.id}:`, err),
    );
  }

  revalidateAll();
  return { targetName: target.name, amount: blood.delta, killed };
}

// Validation comes back as { ok: false, error }, never thrown — Next.js redacts anything thrown out of a Server Action. See web/lib/actionResult.js.

export async function donateBloodRequest(input) {
  return guarded(() => donateBloodRequestImpl(input));
}

export async function feedPersonRequest(input) {
  return guarded(() => feedPersonRequestImpl(input));
}
