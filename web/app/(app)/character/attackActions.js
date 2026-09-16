"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { prisma } from "@lifeweb/db";
import { auth } from "@/lib/auth";
import { sendDm } from "@/lib/discordGuild";
import { guarded, UserError } from "@/lib/actionResult";
import { getOpenTurn } from "@/lib/turn";
import { logAudit } from "@/lib/requests";
import { resolveHereTarget } from "@/lib/hereTarget";
import { resolveTargetKey } from "@lifeweb/db/lib/targetKey";
import { blockerFor, ACT } from "@lifeweb/db/lib/incapacitation";
import { HERE_FIELDS } from "@lifeweb/db/lib/presence";
import { whosHere } from "@lifeweb/db/lib/whosHere";
import { IDENTITY_SELECT, identityOf, seenAs } from "@lifeweb/db/lib/intercept";
import { attackMoveBlock } from "@lifeweb/db/lib/combatGate";
import {
  ATTACK_TAG_SELECT,
  ATTACK_CALLED_OFF_DM,
  attackRefusal,
  attacksBy,
  cancelAttack,
  fileAttack,
} from "@lifeweb/db/lib/attack";

// ATTACKING SOMEBODY, from the character sheet (docs/systemdocs/ATTACK.md).
//
// Same posture as interceptActions.js: the actor is resolved from the session
// and never from a posted id, the dialog's own list is advisory because a
// server action is a public endpoint, and every refusal is a UserError through
// guarded().
//
// It costs nothing — no Move, no ⬢, no Action row. The Gambit you file
// afterwards is what costs your Move. A Move already filed on anything else
// refuses the button (db/lib/combatGate.js, reasoned out in ATTACK.md §5a).

// The identity columns and the fighting columns AT ONCE, for both sides.
// presentedIdentity wants the concealment fields (so a DM names a hooded
// stranger as one); the strength gate wants `fighting` and `equipSlot`. Taking
// either select alone is a silent wrong answer rather than a crash — the
// discipline FIGHTING_TAG_FIELDS states for itself.
const FULL_SELECT = {
  ...IDENTITY_SELECT,
  ...HERE_FIELDS,
  tags: {
    where: { quantity: { gt: 0 } },
    select: {
      equipped: true,
      tag: {
        select: {
          ...IDENTITY_SELECT.tags.select.tag.select,
          ...ATTACK_TAG_SELECT.select.tag.select,
        },
      },
    },
  },
};

async function me({ needs = null } = {}) {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: FULL_SELECT,
  });
  if (!character) redirect("/character");
  if (needs) {
    const blocker = blockerFor(character.tags, needs);
    if (blocker) throw new UserError(`You can't attack anybody — you're ${blocker.name}.`);
  }
  return { session, character };
}

function revalidate() {
  revalidatePath("/character");
  revalidatePath("/gm/turns");
  revalidatePath("/gm/audit");
}

async function loadAttacksImpl() {
  const session = await auth();
  if (!session?.discordUserId) redirect("/");
  const character = await prisma.character.findFirst({
    where: { discordUserId: session.discordUserId, status: "ALIVE" },
    select: { id: true, locationId: true },
  });
  if (!character) redirect("/character");
  const openTurn = await getOpenTurn();

  // The dialog's picker, BOTH halves of it — the same shape Transfer and Search
  // use (web/lib/peoplePools.js). It deliberately does NOT come through
  // peopleHere() any more: that roster drops anybody in a mask, so a man in a
  // closed helm could not be swung at, which made a helmet a shield against
  // being attacked at all. A hood hides WHO somebody is, never THAT they are
  // standing in front of you.
  //
  // A concealed row carries an HMAC token in place of its id, because
  // /api/avatar/<id> answers with a face — shipping the id IS the unmasking.
  // attackCharacterImpl resolves it back through db/lib/targetKey.js.
  const roomNow = await whosHere(prisma, character, { includeSelf: false, withSightings: true });
  return {
    ok: true,
    people: [
      ...roomNow.named.map((row) => ({ id: `character:${row.characterId}`, name: row.name })),
      ...roomNow.concealed.filter((row) => row.token).map((row) => ({ id: `hood:${row.token}`, name: row.alias })),
    ],
    fighting: await attacksBy(prisma, character.id, openTurn?.id ?? null),
    // Why the dialog's Attack button is dead, or null. Advisory — the same
    // sentence is thrown for real below — and it deliberately does NOT reach
    // the Break off rows, which stay live for exactly the player this refuses.
    blocked: await attackMoveBlock(prisma, character.id, openTurn?.id ?? null),
  };
}

async function attackCharacterImpl({ targetKey, targetCharacterId }) {
  const { session, character } = await me({ needs: ACT });
  // `targetCharacterId` is still accepted so a page loaded before this shipped
  // keeps working; the dialog posts `targetKey` now.
  const key = targetKey ?? targetCharacterId;
  if (!key) throw new UserError("Pick somebody to attack.");

  const openTurn = await getOpenTurn();
  if (!openTurn) throw new UserError("There's no turn open right now.");

  // Ahead of the band gate on purpose: somebody who cannot attack at all this
  // turn must not be told, as a consolation prize, that the person they picked
  // was out of their league (docs/systemdocs/COMBAT.md §5).
  const spent = await attackMoveBlock(prisma, character.id, openTurn.id);
  if (spent) throw new UserError(spent);

  // Re-checked server-side on the posted key, never trusted from the dialog.
  // allowConcealed is on inside this helper: a mask is not cover from a fist.
  const target = await resolveHereTarget(character, key, { select: FULL_SELECT });
  if (target.id === character.id) throw new UserError("You can't attack yourself.");

  // THE GATE, and it is the only thing a player ever learns about somebody
  // else's band. See docs/systemdocs/COMBAT.md §5 for why that is a deliberate
  // and narrow exception rather than a hole.
  const refusal = attackRefusal(character.tags, target.tags);
  if (refusal) throw new UserError(refusal);

  const filed = await fileAttack(prisma, {
    attacker: character,
    target,
    openTurn,
    locationId: character.locationId,
  });
  if (filed.already) throw new UserError("You're already fighting them.");
  // Not the same refusal: that one is about a fight still going, this one is about one you called off. Minutes rather than a timestamp, the db/lib/bell.js wording — nobody wants to do clock arithmetic to find out when they may swing again.
  if (filed.cooldownSecondsLeft) {
    const minutes = Math.max(1, Math.ceil(filed.cooldownSecondsLeft / 60));
    throw new UserError(
      `You broke that fight off. Give it about ${minutes} more minute${minutes === 1 ? "" : "s"} before going back in.`,
    );
  }

  const seen = seenAs(identityOf(target));
  await logAudit(prisma, {
    actorDiscordUserId: session.discordUserId,
    actionType: "request_attack_filed",
    targetCharacterId: target.id,
    turnId: openTurn.id,
    // `presented`, not the real name — the audit log is not a place to unmask
    // somebody the game just refused to unmask (the intercept.js rule).
    details: { presented: seen, locationId: character.locationId },
  });

  // Post-commit, after() rather than inside: no network call may run inside a
  // transaction, and a Discord outage must not undo the fight.
  after(() => {
    for (const dm of filed.dms) {
      sendDm(dm.discordUserId, dm.content, {
        kind: dm.kind,
        components: dm.components,
        meta: dm.meta,
        // A character name is player-typed, so it rides in these lines. The
        // same belt the Intercept DMs wear, and it costs nothing.
        allowedMentions: { parse: [] },
      }).catch(() => {});
    }
  });

  revalidate();
  return { ok: true, line: `You attack ${seen}.` };
}

async function cancelAttackImpl({ targetKey, targetCharacterId }) {
  const { session, character } = await me();
  const openTurn = await getOpenTurn();
  if (!openTurn) throw new UserError("There's no turn open right now.");

  // NO combatGate check here, deliberately. Breaking off is the one way out of
  // a fight for a player whose Move is already spent, and gating it would trap
  // exactly the person the gate above exists to protect somebody from.
  //
  // The row resolves from a KEY, because an opponent in a mask is listed by
  // token rather than id (db/lib/attack.js#attacksBy) — you can break off a
  // fight with a stranger without ever learning who they were. No co-presence
  // check: you may call off a fight with somebody who has already walked away,
  // which is the whole point of Break off, so this cannot use
  // resolveHereTarget() and resolves the key directly instead.
  const targetId = (await resolveTargetKey(prisma, character, targetKey ?? targetCharacterId)) ?? "";
  const target = targetId
    ? await prisma.character.findUnique({
        where: { id: targetId },
        select: { ...IDENTITY_SELECT, status: true },
      })
    : null;
  // cancelAttack's WHERE is the ownership check — only the person who started
  // it may call it off — so there is no second lookup here to disagree with it.
  const done = await cancelAttack(prisma, {
    attackerId: character.id,
    targetCharacterId: targetId,
    turnId: openTurn.id,
  });
  if (!done.ok) throw new UserError("You aren't fighting them.");

  const seen = target ? seenAs(identityOf(target)) : "them";
  await logAudit(prisma, {
    actorDiscordUserId: session.discordUserId,
    actionType: "request_attack_cancelled",
    targetCharacterId: targetId || null,
    turnId: openTurn.id,
    details: { presented: seen },
  });

  if (target?.discordUserId && target.status === "ALIVE") {
    after(() => sendDm(target.discordUserId, ATTACK_CALLED_OFF_DM, { allowedMentions: { parse: [] } }).catch(() => {}));
  }
  revalidate();
  return { ok: true, line: `You break off from ${seen}.` };
}

export async function loadAttacks() {
  return guarded(() => loadAttacksImpl());
}
export async function attackCharacterRequest(input) {
  return guarded(() => attackCharacterImpl(input ?? {}));
}
export async function cancelAttackRequest(input) {
  return guarded(() => cancelAttackImpl(input ?? {}));
}
