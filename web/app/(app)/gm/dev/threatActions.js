"use server";

// The two threat verbs, behind /gm/dev?s=assignments.
//
// ASSIGN hands a seat to a character who already exists: its tags and its
// points. SPAWN offers a whole new character to somebody who has none — it
// writes the offer and DMs the buttons; the accept lands in the bot, because
// a DM has no guild (bot/src/lib/threatSpawn.js).
//
// Both re-check everything the UI already checked. A server action is a public
// endpoint, and a hidden button is a hint, not a lock.
import { revalidatePath } from "next/cache";
import { prisma } from "@lifeweb/db";
import { threatBySlug } from "@lifeweb/db/lib/threats";
import { DM_ACTION, dmAction } from "@lifeweb/db/lib/dmActions";
import { resolveAssignTags, spawnOfferComponents } from "@lifeweb/db/lib/threatSpawn";
import { resolveSeatConflicts, describeSeatConflicts } from "@lifeweb/db/lib/seatConflicts";
import { expiryForGrant } from "@lifeweb/db/lib/grantExpiry";
import { isSpawnOnly } from "@lifeweb/db/lib/roleCapacity";
import { requireDev } from "@/lib/devAccess";
import { sendDm } from "@/lib/discordGuild";


function repaint() {
  revalidatePath("/gm/dev");
  revalidatePath("/gm/players", "layout");
}

// A {tag:…} token in a Role's description, flattened to the tag's name for a
// DM — Discord has no chip to render it into. Looked up, not title-cased, so a
// tag whose name is not its slug still reads right.
async function flattenTagTokens(lines) {
  const slugs = new Set();
  for (const line of lines) for (const m of line.matchAll(/\{tag:([^}]+)\}/g)) slugs.add(m[1]);
  if (!slugs.size) return lines;
  const tags = await prisma.tag.findMany({ where: { slug: { in: [...slugs] } }, select: { slug: true, name: true } });
  const names = new Map(tags.map((t) => [t.slug, t.name]));
  return lines.map((line) => line.replace(/\{tag:([^}]+)\}/g, (_, slug) => names.get(slug) ?? slug));
}

// The DM a newly-seated threat reads. What sits between the opening and the
// tail is the Role's own charter from docs/roles.yaml — its intro and its
// description lines, Bascinet's words — never a second copy written here.
// Assign hands a seat to a character who already has a role, so it carries no
// charter at all. Bascinet signed off on these words on 2026-09-08.
//
// A seat with a `brief` (only the Thanati, who have no Role of their own —
// db/lib/threats.js) reads it instead of the generic Assign opener, since its
// first line already says what they are. The Spawn OFFER never carries it: a
// player who declines must not have read the cult's doctrine, so the bot sends
// the brief only once Accept has landed (bot/src/lib/threatSpawn.js).
async function seatMessage(threat, { role = null, spawned = false } = {}) {
  const opening = spawned
    ? `You have been offered a seat: the ${threat.name}.`
    : `You are now the ${threat.name}!`;
  const tail = spawned
    ? "Accept and you arrive immediately. Decline and nothing happens."
    : "Check your tags and documents.";
  const brief = !spawned && threat.brief?.length ? threat.brief : [opening];
  const intro = role?.intro?.trim();
  const charter = await flattenTagTokens([...(intro ? [intro] : []), ...(role?.description ?? [])]);
  return [...brief, ...charter, tail].join("\n");
}

// Hands an existing character a seat. Any threat, opted in or not — consent is
// a GM's judgement call, and the opt-in column is there to inform it, not to
// gate it.
export async function assignThreat({ characterId, threatSlug }) {
  let session;
  try {
    session = await requireDev("gm");
  } catch {
    return { error: "Not authorized." };
  }

  const threat = threatBySlug(threatSlug);
  if (!threat?.assignable) return { error: "That isn't an assignable threat." };

  const character = await prisma.character.findUnique({
    where: { id: characterId },
    select: { id: true, name: true, discordUserId: true, status: true },
  });
  if (!character) return { error: "That character no longer exists." };
  if (character.status !== "ALIVE") {
    return { error: `${character.name} isn't alive. Spawn a new character instead.` };
  }

  // Already seated? Refuse rather than run again. The tag upsert below is
  // idempotent but the point grant is NOT — a second press would quietly hand
  // over another 7 or 17 points, and a double-click is the likeliest way this
  // button gets pressed twice.
  if (threat.seatTagSlug) {
    const held = await prisma.characterTag.count({
      where: { characterId: character.id, tag: { slug: threat.seatTagSlug } },
    });
    if (held > 0) return { error: `${character.name} is already the ${threat.name}.` };
  }

  const resolved = await resolveAssignTags(prisma, threat);
  if (resolved.error) return { error: resolved.error };

  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } });

  // Stamped before the transaction, since a tag with a catalog duration must
  // arrive already carrying expiresTurn.
  const rows = [];
  for (const { tag, quantity } of resolved.tags) {
    rows.push({
      tagId: tag.id,
      name: tag.name,
      quantity: tag.stackable ? quantity : 1,
      expiresTurn: await expiryForGrant(prisma, tag, openTurn, { where: "assignThreat" }),
    });
  }

  let conflicts = { refunded: [], removed: [], kept: [], stripped: [], points: 0, clawedBack: 0 };
  await prisma.$transaction(async (tx) => {
    for (const row of rows) {
      // Upsert rather than create: a GM may have granted the seat tag by hand
      // already, and a duplicate would violate the (characterId, tagId) unique.
      await tx.characterTag.upsert({
        where: { characterId_tagId: { characterId: character.id, tagId: row.tagId } },
        update: {},
        create: {
          characterId: character.id,
          tagId: row.tagId,
          source: "GM_GRANT",
          quantity: row.quantity,
          expiresTurn: row.expiresTurn,
        },
      });
    }
    if (threat.assign?.tagPoints) {
      await tx.character.update({
        where: { id: character.id },
        data: { tagPoints: { increment: threat.assign.tagPoints } },
      });
    }
    // What the seat forbids and the character already had: every Addiction
    // and any Personality tag that locks one of the seat's own Desires taken
    // outright (points clawed back with them), then the older pairwise rules
    // — refunded if it cost points, kept if it was a drawback, gone either
    // way if it is a second Belief (db/lib/seatConflicts.js).
    conflicts = await resolveSeatConflicts(tx, character.id, rows.map((r) => r.tagId));
    await tx.auditLog.create({
      data: {
        actorDiscordUserId: session.discordUserId,
        actionType: "threat_assigned",
        targetCharacterId: character.id,
        details: {
          threat: threat.name,
          tagPoints: threat.assign?.tagPoints ?? 0,
          tags: rows.map((r) => r.name),
          refunded: conflicts.refunded,
          removed: conflicts.removed,
          kept: conflicts.kept,
          stripped: conflicts.stripped,
          clawedBack: conflicts.clawedBack,
        },
      },
    });
  });

  // Post-commit, but AWAITED rather than deferred to after(): the grant is
  // already committed, so a failed DM still cannot cost it, and the GM is the
  // only person who can do anything about a player who was never told. This
  // used to run in after() with the error swallowed to console, so a seat
  // granted and never announced returned a clean ok.
  //
  // sendDm applies the » prefix, splits past 2000 characters and logs to
  // DirectMessage, so /gm/messages shows the whole thing.
  const conflictLine = describeSeatConflicts(conflicts);
  const sent = await sendDm(
    character.discordUserId,
    [await seatMessage(threat), conflictLine].filter(Boolean).join("\n"),
    { authorDiscordUserId: session.discordUserId, source: "threat_assign" },
  ).catch((err) => {
    console.error("Threat assign DM failed:", err);
    return null;
  });

  repaint();
  return {
    ok: true,
    threat: threat.name,
    tags: rows.map((r) => r.name),
    dmFailed: !sent,
  };
}

// Offers a seat to somebody with no character. Writes the row, DMs the buttons.
export async function offerThreatSpawn({ discordUserId, threatSlug, roleId, locationId }) {
  let session;
  try {
    session = await requireDev("gm");
  } catch {
    return { error: "Not authorized." };
  }

  const threat = threatBySlug(threatSlug);
  if (!threat?.spawn) return { error: "That threat can't be spawned." };
  if (!discordUserId) return { error: "Pick somebody to offer it to." };

  const wantedRoleSlug = threat.spawn.roleSlug ?? null;
  const role = wantedRoleSlug
    ? await prisma.role.findUnique({ where: { slug: wantedRoleSlug } })
    : roleId
      ? await prisma.role.findUnique({ where: { id: roleId } })
      : null;
  if (!role) return { error: "Pick a starting role." };
  // The dropdown already hides these, and a hidden option is a hint, not a
  // lock. A spawn-only role is somebody else's seat: handed out as a cover
  // role it DMs the recruit that seat's whole charter.
  if (!wantedRoleSlug && isSpawnOnly(role)) {
    return { error: `${role.name} is a seat of its own, not a cover role. Pick another. \u2021` };
  }

  if (await prisma.character.findFirst({ where: { discordUserId, status: "ALIVE" } })) {
    return { error: "They already have a living character. Assign the seat instead." };
  }
  if (await prisma.threatSpawn.findFirst({ where: { discordUserId, status: "PENDING" } })) {
    return { error: "They already have an offer waiting. Cancel it first." };
  }

  // The GM's pick wins, then the seat's own landing site (only the Tribunal
  // carries one — db/lib/threats.js), then the role's start. Null only if none
  // of the three says anything.
  let seatLocationId = null;
  if (threat.spawn?.locationSlug) {
    const seatLocation = await prisma.location.findUnique({
      where: { slug: threat.spawn.locationSlug },
      select: { id: true },
    });
    if (!seatLocation) {
      console.error(
        `Threat ${threat.slug}: spawn.locationSlug "${threat.spawn.locationSlug}" matches no Location — check docs/zones.yaml against db:import-zones, or Reconcile now on /gm/dev/zones.`,
      );
    }
    seatLocationId = seatLocation?.id ?? null;
  }
  const finalLocationId = locationId || seatLocationId || role.startingLocationId || null;

  const spawn = await prisma.threatSpawn.create({
    data: {
      discordUserId,
      threatSlug: threat.slug,
      roleId: role.id,
      locationId: finalLocationId,
      offeredBy: session.discordUserId,
    },
  });

  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "threat_spawn_offered",
      details: { threat: threat.name, discordUserId, role: role.name },
    },
  });

  const sent = await sendDm(discordUserId, await seatMessage(threat, { role, spawned: true }), {
    authorDiscordUserId: session.discordUserId,
    source: "threat_spawn_offer",
    components: spawnOfferComponents(spawn.id),
    meta: dmAction(DM_ACTION.THREAT_SPAWN, spawn.id),
  }).catch((err) => {
    console.error("Threat spawn offer DM failed:", err);
    return null;
  });

  // An offer nobody can see is worse than none: roll it back so the GM can
  // retry rather than leaving a live row with no buttons behind it.
  if (!sent) {
    await prisma.threatSpawn.update({
      where: { id: spawn.id },
      data: { status: "CANCELLED", resolvedAt: new Date() },
    });
    repaint();
    return { error: "Couldn't DM them — their DMs may be closed. Nothing was offered." };
  }

  repaint();
  return { ok: true, threat: threat.name, role: role.name };
}

export async function cancelThreatSpawn({ spawnId }) {
  let session;
  try {
    session = await requireDev("gm");
  } catch {
    return { error: "Not authorized." };
  }

  const spawn = await prisma.threatSpawn.findUnique({ where: { id: spawnId } });
  if (!spawn) return { error: "That offer no longer exists." };
  if (spawn.status !== "PENDING") return { error: "That offer has already been answered." };

  await prisma.threatSpawn.update({
    where: { id: spawn.id },
    data: { status: "CANCELLED", resolvedAt: new Date() },
  });
  await prisma.auditLog.create({
    data: {
      actorDiscordUserId: session.discordUserId,
      actionType: "threat_spawn_cancelled",
      details: { threat: spawn.threatSlug, discordUserId: spawn.discordUserId },
    },
  });

  repaint();
  return { ok: true };
}
