"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { guarded, UserError } from "@/lib/actionResult";
import { getOpenTurn } from "@/lib/turn";
import { logAudit } from "@/lib/requests";
import { afterInventoryChange } from "@/lib/afterInventoryChange";
import { grantTagSlugs, dropCharacterTag } from "@lifeweb/db/lib/tagWrites";
import { FULL_NAME_LIMIT } from "@/lib/characterName";
import {
  WANTED_SLUG,
  CERBERON_SLUG,
  WARRANT_BADGE_SLUGS,
  warrantTargets,
  unwarrantTargets,
  listWanted,
} from "@lifeweb/db/lib/wanted";

// The CERBERON section of the character panel: Arrest Warrant and Check
// Wanted. Same posture as thanatiActions.js — each one resolves the officer
// from the session, never from a posted id, and re-checks the tag the button's
// `show` already read, because a server action is a public endpoint and a
// hidden button is a hint, not a lock.

async function cerberon({ needsBadge = false } = {}) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const me = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: {
      id: true,
      name: true,
      tags: { where: { quantity: { gt: 0 } }, select: { tag: { select: { slug: true } } } },
    },
  });
  if (!me) redirect("/character");
  const slugs = new Set(me.tags.map((ct) => ct.tag.slug));
  const allowed = needsBadge
    ? WARRANT_BADGE_SLUGS.some((slug) => slugs.has(slug))
    : slugs.has(CERBERON_SLUG);
  if (!allowed) throw new UserError("Not yours to press.");
  return { session, me, slugs };
}

function revalidate() {
  revalidatePath("/character");
  revalidatePath("/gm/audit");
}

// ---- Arrest Warrant --------------------------------------------------------
// A badge holder writes a name down and that man is Wanted. The name is
// TYPED, not picked (Engrave's reasoning: a dropdown would be a full roster
// handed to anyone), and is the whole name so a warrant against the wrong
// Jorren isn't easy. A name TWO living men answer to warrants BOTH of them —
// the law doesn't know which one it wants (warrantTargets() in
// db/lib/wanted.js, pure and tested). Costs NOTHING — no Move, no ⬢, no
// Routine — and deliberately does NOT call postWantedPosters: no paper goes
// up, the only way anyone finds out is by looking the man in the face.
async function arrestWarrantRequestImpl({ name: rawName }) {
  const { session, me } = await cerberon({ needsBadge: true });

  const typed = rawName?.toString().trim().slice(0, FULL_NAME_LIMIT) ?? "";
  if (!typed) throw new UserError("Whose name?");

  // A composed name isn't something Prisma can compare against, so the living roster comes back and warrantTargets does the rest.
  const candidates = await prisma.character.findMany({
    where: { status: "ALIVE" },
    select: {
      id: true,
      name: true,
      firstName: true,
      lastName: true,
      tags: { where: { tag: { slug: WANTED_SLUG } }, select: { id: true, tagId: true } },
    },
  });
  const { matched, targets, skippedSelf, alreadyWanted } = warrantTargets(candidates, typed, {
    selfId: me.id,
  });
  // Three refusals, each distinct — "nobody by that name" vs. "already wanted" look identical from the officer's side otherwise.
  if (matched === 0) throw new UserError("There's nobody with that name.");
  if (targets.length === 0) {
    // grantTagSlugs would silently no-op on a non-stackable tag already held.
    if (alreadyWanted > 0) throw new UserError("That person is already marked as wanted.");
    // Nothing left and nobody already wanted: the only match was the officer themselves.
    if (skippedSelf > 0) throw new UserError("Swear it out on somebody else.");
    throw new UserError("There's nobody with that name.");
  }

  const openTurn = await getOpenTurn();
  await prisma.$transaction(async (tx) => {
    for (const target of targets) {
      await grantTagSlugs(tx, target.id, [WANTED_SLUG], openTurn?.number ?? null);
      // One row PER MAN — /gm/audit is read by target, so a shared row would leave the second man's sheet with no record.
      await logAudit(tx, {
        actorDiscordUserId: session.discordUserId,
        actionType: "request_arrest_warrant",
        targetCharacterId: target.id,
        turnId: openTurn?.id ?? null,
        details: {
          name: target.name,
          typed,
          by: me.name,
          // Only present when the name was ambiguous.
          ...(matched > 1 ? { answeringToThatName: matched } : {}),
        },
      });
    }
  });

  await afterInventoryChange(targets.map((t) => t.id));
  revalidate();
  const name = targets[0].name;
  return {
    ok: true,
    name,
    caught: targets.length,
    line:
      matched > 1
        ? `A warrant is out on ${name} — ${matched} men answer to that name.`
        : `A warrant is out on ${name}.`,
  };
}

// ---- Remove Warrant --------------------------------------------------------
// The mirror of the above, and the only thing short of a Mulligan Potion that
// takes a name back out of the book. Same badge, same typed name — a picker
// here would be the warrant book handed to anybody carrying a badge, and
// reading the book is Check Wanted's job, which asks to be sworn. Same silence
// too: nothing is posted, nothing is sent, the man simply stops being wanted.
async function removeWarrantRequestImpl({ name: rawName }) {
  const { session, me } = await cerberon({ needsBadge: true });

  const typed = rawName?.toString().trim().slice(0, FULL_NAME_LIMIT) ?? "";
  if (!typed) throw new UserError("Whose name?");

  const candidates = await prisma.character.findMany({
    where: { status: "ALIVE" },
    select: {
      id: true,
      name: true,
      firstName: true,
      lastName: true,
      tags: { where: { tag: { slug: WANTED_SLUG } }, select: { id: true, tagId: true } },
    },
  });
  const { matched, targets, skippedSelf, notWanted } = unwarrantTargets(candidates, typed, {
    selfId: me.id,
  });
  if (matched === 0) throw new UserError("There's nobody with that name.");
  if (targets.length === 0) {
    if (notWanted > 0) throw new UserError("That person isn't wanted.");
    if (skippedSelf > 0) throw new UserError("Somebody else has to lift it.");
    throw new UserError("There's nobody with that name.");
  }

  const openTurn = await getOpenTurn();
  await prisma.$transaction(async (tx) => {
    for (const target of targets) {
      await dropCharacterTag(tx, target.id, target.tags[0].tagId);
      // One row PER MAN, the reason the warrant path gives above.
      await logAudit(tx, {
        actorDiscordUserId: session.discordUserId,
        actionType: "request_remove_warrant",
        targetCharacterId: target.id,
        turnId: openTurn?.id ?? null,
        details: {
          name: target.name,
          typed,
          by: me.name,
          ...(matched > 1 ? { answeringToThatName: matched } : {}),
        },
      });
    }
  });

  await afterInventoryChange(targets.map((t) => t.id));
  revalidate();
  const name = targets[0].name;
  return {
    ok: true,
    name,
    caught: targets.length,
    line:
      matched > 1
        ? `The warrant on ${name} is lifted — ${matched} men answer to that name.`
        : `The warrant on ${name} is lifted.`,
  };
}

// ---- Check Wanted ----------------------------------------------------------
// The warrant book, read as a notice — same shape as Recall Comrades
// (thanatiActions.js). Costs nothing, spends no Move. Lists a hooded man the
// same as a bare-faced one, on purpose: this is a RECORD, not an act of
// looking, and closing the gap between the name and the stranger is the game.
async function checkWantedImpl() {
  const { session, me } = await cerberon();
  const rows = await listWanted(prisma);
  await logAudit(prisma, {
    actorDiscordUserId: session.discordUserId,
    actionType: "request_check_wanted",
    targetCharacterId: me.id,
    details: { wanted: rows.map((r) => r.name) },
  });
  revalidate();
  return {
    ok: true,
    // Names only. The role is a spoiler — see listWanted in db/lib/wanted.js.
    roster: rows.map((r) => ({ name: r.name })),
    line: rows.length ? "The warrant book." : "Nobody is wanted.",
  };
}

export async function arrestWarrantRequest(input) {
  return guarded(() => arrestWarrantRequestImpl(input ?? {}));
}
export async function removeWarrantRequest(input) {
  return guarded(() => removeWarrantRequestImpl(input ?? {}));
}
export async function checkWanted() {
  return guarded(() => checkWantedImpl());
}
