// Spawning a threat: turning an offer into a character. The GM presses SPAWN on /gm/dev?s=assignments, which writes a ThreatSpawn row and DMs the
// target Accept/Decline buttons. The click lands in the BOT (a DM has no guild), so this shared work lives here — bot/src/lib/threatSpawn.js stays thin.
// This module does the DATABASE half only and RETURNS what the caller must do to Discord (ARCHITECTURE.md's returned-side-effects pattern) — creating
// the personal role and placing the character are REST calls the two faces already own differently. The transaction mirrors createCharacter's
// (web/app/(app)/character/createActions.js); where it differs, nobody is picking — name, gender and rank are all rolled off the seat (rollSpawnIdentity).
const { parseStartingTag } = require("./startingTags");
const { roleCapacity } = require("./roleCapacity");
const { heldSeats } = require("./seatCount");
const { settleLobbyEntry } = require("./lobby");
const { readGameState, effectivePlayerCount } = require("./gameState");
const { formatCharacterName, formatBareName } = require("./characterName");
const { expiryForGrant } = require("./grantExpiry");
const { createGuildRole } = require("./discordRest");
const { closeDeadchatTo } = require("./deadchat");
const { characterRoleAppearance } = require("./characterRoleAppearance");
const { applyLocationMoveSideEffects } = require("./locationMove");
const { seedMemories } = require("./locationVisits");
const { startingMemorySlugs } = require("./startingMemories");
const {
  threatBySlug,
  rollSpawnIdentity,
  THREAT_SPAWN_ACCEPT_PREFIX,
  THREAT_SPAWN_DECLINE_PREFIX,
  SHUTTLE_ARRIVAL_SLUGS,
} = require("./threats");
const { ambientEverywhere } = require("./worldBroadcast");

// The two buttons on an offer DM. Raw component JSON rather than discord.js builders, since the web sends this one and only the bot has the library.
function spawnOfferComponents(spawnId) {
  return [
    {
      type: 1,
      components: [
        { type: 2, style: 3, custom_id: `${THREAT_SPAWN_ACCEPT_PREFIX}${spawnId}`, label: "Accept" },
        { type: 2, style: 2, custom_id: `${THREAT_SPAWN_DECLINE_PREFIX}${spawnId}`, label: "Decline" },
      ],
    },
  ];
}

// A tag list written as SLUGS with an optional count — "obol x4". parseStartingTag splits the count off.
function parseSlugEntries(entries = []) {
  const wanted = new Map();
  for (const entry of entries) {
    const { slug, quantity } = parseStartingTag(entry);
    wanted.set(slug, (wanted.get(slug) ?? 0) + quantity);
  }
  return wanted;
}

// Every tag a spawn hands over: the seat's own grant, its starting kit, and whatever the role it lands in grants anyone. Resolved in one pass so a
// missing slug is a clean refusal rather than a half-granted character.
async function resolveSpawnTags(db, threat, role) {
  // The seat's own two lists and the role's, all slugs, all one map — largest count wins where a tag arrives from two directions at once.
  const seatSlugs = parseSlugEntries([
    ...(threat.assign?.tagSlugs ?? []),
    ...(threat.spawn?.tagSlugs ?? []),
  ]);
  const bySlug = new Map(seatSlugs);
  for (const [slug, quantity] of parseSlugEntries(role?.startingTagSlugs ?? [])) {
    bySlug.set(slug, Math.max(quantity, bySlug.get(slug) ?? 0));
  }
  if (!bySlug.size) return { tags: [] };

  const tags = await db.tag.findMany({ where: { slug: { in: [...bySlug.keys()] } } });

  // Only the SEAT's own slugs are a hard error — a role's list is already validated by db:sync-roles.
  const missing = [...seatSlugs.keys()].filter((s) => !tags.some((t) => t.slug === s));
  if (missing.length) {
    return { error: `The ${threat.name} seat names tags that aren't in the catalog: ${missing.join(", ")}.` };
  }

  return { tags: tags.map((tag) => ({ tag, quantity: bySlug.get(tag.slug) ?? 1 })) };
}

// The tags an ASSIGN hands to an existing character — the seat's grant only, never the spawn kit.
async function resolveAssignTags(db, threat) {
  const bySlug = parseSlugEntries(threat.assign?.tagSlugs ?? []);
  if (!bySlug.size) return { tags: [] };
  const tags = await db.tag.findMany({ where: { slug: { in: [...bySlug.keys()] } } });
  const missing = [...bySlug.keys()].filter((s) => !tags.some((t) => t.slug === s));
  if (missing.length) {
    return { error: `The ${threat.name} seat names tags that aren't in the catalog: ${missing.join(", ")}.` };
  }
  return { tags: tags.map((tag) => ({ tag, quantity: bySlug.get(tag.slug) ?? 1 })) };
}

// Accepts an offer. Never throws for a refusal a player caused — the caller writes the reason under their own DM.
async function acceptThreatSpawn(prisma, spawnId, discordUserId) {
  const spawn = await prisma.threatSpawn.findUnique({
    where: { id: spawnId },
    include: {
      role: { include: { faction: { include: { zone: true } } } },
      location: { include: { zone: true } },
    },
  });
  if (!spawn) return { ok: false, reason: "That offer's gone." };
  if (spawn.discordUserId !== discordUserId) return { ok: false, reason: "That's not yours to answer." };
  if (spawn.status !== "PENDING") return { ok: false, reason: "That offer has already been answered." };

  const threat = threatBySlug(spawn.threatSlug);
  if (!threat?.spawn) return { ok: false, reason: "That seat is no longer available." };

  if (await prisma.character.findFirst({ where: { discordUserId, status: "ALIVE" } })) {
    return { ok: false, reason: "You already have a character." };
  }

  const [config, state, openTurn, resolved] = await Promise.all([
    prisma.gameConfig.findUnique({ where: { id: 1 } }),
    readGameState(prisma, { playerCount: true }),
    prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true, number: true } }),
    resolveSpawnTags(prisma, threat, spawn.role),
  ]);
  if (resolved.error) return { ok: false, reason: `${resolved.error}` };

  // Location may be overridden by the GM; the role's own start is the fallback. zoneId is written from the SAME location in the same statement.
  const locationId = spawn.locationId ?? spawn.role.startingLocationId ?? null;
  const location =
    spawn.locationId && spawn.location
      ? spawn.location
      : locationId
        ? await prisma.location.findUnique({ where: { id: locationId }, include: { zone: true } })
        : null;

  const { gender, firstName, honorific } = rollSpawnIdentity(threat.spawn);
  const name = formatCharacterName({ honorific, firstName, title: null, lastName: null });

  // Stamped before the transaction: a tag with a catalog duration must arrive already carrying expiresTurn, since nothing backfills it later.
  const tagRows = [];
  for (const { tag, quantity } of resolved.tags) {
    tagRows.push({
      tagId: tag.id,
      source: "GM_GRANT",
      expiresTurn: await expiryForGrant(prisma, tag, openTurn, { where: "acceptThreatSpawn" }),
      quantity: tag.stackable ? quantity : 1,
    });
  }

  let created;
  try {
    created = await prisma.$transaction(async (tx) => {
      // The lock that actually closes the seat race — Prisma runs READ COMMITTED, so counting without it can seat two people at once.
      await tx.$queryRaw`SELECT id FROM "Role" WHERE id = ${spawn.roleId} FOR UPDATE`;
      const taken = await heldSeats(tx, spawn.role, { excludeDiscordUserId: discordUserId });
      if (taken >= roleCapacity(spawn.role, effectivePlayerCount(config, state))) throw new Error("ROLE_FULL");

      // Re-read under the lock: two clicks race here; the status check above is only an early out.
      const fresh = await tx.threatSpawn.findUnique({ where: { id: spawn.id }, select: { status: true } });
      if (fresh?.status !== "PENDING") throw new Error("ALREADY_ANSWERED");

      const character = await tx.character.create({
        data: {
          discordUserId,
          honorific,
          firstName,
          title: null,
          lastName: null,
          name,
          gender,
          age: null,
          roleId: spawn.role.id,
          roleTitle: spawn.role.name,
          factionId: spawn.role.factionId,
          locationId: location?.id ?? null,
          zoneId: location?.zoneId ?? null,
          resources: threat.spawn.resources ?? spawn.role.startingResources,
          tagPoints: threat.spawn.tagPoints ?? 0,
          isLeader: spawn.role.grantsLeader,
          isTreasurer: spawn.role.grantsTreasurer,
        },
      });

      if (tagRows.length) {
        await tx.characterTag.createMany({
          data: tagRows.map((row) => ({ characterId: character.id, ...row })),
        });
      }

      await tx.threatSpawn.update({
        where: { id: spawn.id },
        data: { status: "ACCEPTED", characterId: character.id, resolvedAt: new Date() },
      });
      // A rolled seat this player was still holding is spent by this character.
      await settleLobbyEntry(tx, discordUserId, character.id);

      return character;
    });
  } catch (err) {
    if (err.message === "ROLE_FULL") {
      return { ok: false, reason: `There's no ${spawn.role.name} seat left. Tell a GM.` };
    }
    if (err.message === "ALREADY_ANSWERED") {
      return { ok: false, reason: "That offer has already been answered." };
    }
    throw err;
  }

  return {
    ok: true,
    character: created,
    threat,
    // What the caller must do to Discord, in order — each best-effort, none may cost the create.
    sideEffects: {
      characterId: created.id,
      discordUserId,
      bareName: formatBareName({ firstName, lastName: null }),
      toLocationId: created.locationId,
      // threatSlug: so the side-effect step can tell whether the whole map should hear a shuttle come down. roleSlug: decides what this
      // character already knows of the map (db/lib/startingMemories.js).
      threatSlug: threat.slug,
      roleSlug: spawn.role.slug,
    },
    turn: openTurn,
    line: created.locationId
      ? `You are now the ${threat.name}. You wake as ${name}, in ${location?.name ?? "the dark"}.`
      : `You are now the ${threat.name}. You wake as ${name}.`,
  };
}

async function declineThreatSpawn(prisma, spawnId, discordUserId) {
  const spawn = await prisma.threatSpawn.findUnique({ where: { id: spawnId } });
  if (!spawn) return { ok: false, reason: "That offer's gone." };
  if (spawn.discordUserId !== discordUserId) return { ok: false, reason: "That's not yours to answer." };
  if (spawn.status !== "PENDING") return { ok: false, reason: "That offer has already been answered." };

  await prisma.threatSpawn.update({
    where: { id: spawn.id },
    data: { status: "DECLINED", resolvedAt: new Date() },
  });
  return { ok: true, line: "You turned the seat down." };
}


// The Discord half of an accept, run post-commit and entirely best-effort: none of it may cost a character that already exists. Lives here because
// the accept happens in the BOT (a DM has no guild) while everything it needs is REST (db/lib/discordRest.js). The personal role is a MENTIONABLE
// NAME TOKEN held by nobody — channel access rides the zone role and the Location overwrite instead (CHANNELS.md §3).
async function applySpawnSideEffects(prisma, sideEffects) {
  const { characterId, discordUserId, bareName, toLocationId, threatSlug, roleSlug } = sideEffects;

  try {
    const { name, color } = characterRoleAppearance(bareName);
    // permissions: "0" is NOT the API default — omitting it copies @everyone's bits, which fools db:prune-orphan-roles into treating it as real access.
    const role = await createGuildRole({ name, color, hoist: false, mentionable: true, permissions: "0" });
    await prisma.character.update({ where: { id: characterId }, data: { discordRoleId: role.id } });
  } catch (err) {
    console.error("Spawn role creation failed:", err);
  }

  if (toLocationId) {
    await applyLocationMoveSideEffects(prisma, {
      characterId,
      fromLocationId: null,
      toLocationId,
    }).catch((err) => console.error("Spawn placement failed:", err));
  }

  // The map this seat wakes up with — same seeding createCharacter does, after placement, since arrival has already recorded where they stand.
  if (roleSlug) {
    try {
      const character = await prisma.character.findUnique({
        where: { id: characterId },
        include: { tags: { select: { equipped: true, tag: { select: { slug: true } } } } },
      });
      if (character) {
        const heldSlugs = character.tags.map((t) => t.tag.slug);
        await seedMemories(prisma, character, startingMemorySlugs(roleSlug, heldSlugs));
      }
    } catch (err) {
      console.error("Spawn memory seeding failed:", err);
    }
  }

  // A spawned threat is alive again, so the Deadchat seat comes off — neither the curse nor the
  // ghost seat needs a write, db/lib/curse.js and db/lib/ghost.js both derive from the ALIVE row.
  await closeDeadchatTo(prisma, discordUserId).catch(() => {});

  // The Tribunal arrives by shuttle: every Location on the map, not a range from an origin — the sky is not a noise.
  if (SHUTTLE_ARRIVAL_SLUGS.has(threatSlug)) {
    await ambientEverywhere(prisma, "You see a shuttle in the sky. It landed nearby.", {
      signed: false,
    }).catch((err) =>
      console.error("Shuttle arrival broadcast failed:", err),
    );
  }
}

module.exports = {
  applySpawnSideEffects,
  spawnOfferComponents,
  acceptThreatSpawn,
  declineThreatSpawn,
  resolveAssignTags,
};
