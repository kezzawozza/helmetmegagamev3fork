// The lobby's database half (docs/systemdocs/LOBBY.md): building the roll's
// input, checking a previewed draft still fits, committing it, and declining
// a seat. The web action sends the DMs; the bot routes the Decline click.

const { assignRoles, newSeed } = require("./roleAssignment");
const { roleCapacity, isSpawnOnly } = require("./roleCapacity");
const { heldSeatsByRole } = require("./seatCount");
const { LEADER_WHITELIST_ROLE_ID } = require("./roleIds");
const { getGameConfig } = require("./gameState");
const { pickTurnBanner } = require("./turnBanner");

// Button customId prefix for the assignment DM's Decline (web builds it, bot routes the click).
const LOBBY_DECLINE_PREFIX = "lobby-decline:";

// Nine percent over the readied count, for late joins.
const READY_HEADROOM = 1.09;

// Phases a roll may be previewed/committed in. CLOSED with readied rows is a
// FROZEN lobby — Close lobby, Preview, Start keeps someone readying up between
// the two from spoiling the draft.
const ROLL_PHASES = new Set(["LOBBY", "CLOSED"]);

// Everything assignRoles needs, read fresh. `memberRoles` maps discordUserId
// -> Discord role ids (from listGuildMembers), the only Discord fact the roll reads.
async function loadAssignmentInput(db, memberRoles) {
  const [config, entries, prefs, roles] = await Promise.all([
    getGameConfig(db),
    // Ordered so the seeded shuffle is reproducible.
    db.lobbyEntry.findMany({ where: { status: "READY" }, orderBy: [{ readyAt: "asc" }, { id: "asc" }], select: { discordUserId: true } }),
    db.playerPreference.findMany(),
    db.role.findMany({
      select: {
        id: true, slug: true, name: true, isUnique: true, unlimited: true, weight: true,
        requiresWhitelist: true, grantsLeader: true, factionId: true,
      },
    }),
  ]);
  const prefByUser = new Map(prefs.map((p) => [p.discordUserId, p]));
  const players = entries.map((e) => {
    const p = prefByUser.get(e.discordUserId);
    return {
      discordUserId: e.discordUserId,
      priorities: p?.rolePriorities ?? {},
      joblessRole: p?.joblessRole ?? "COMMONER",
      whitelisted: (memberRoles.get(e.discordUserId) ?? []).includes(LEADER_WHITELIST_ROLE_ID),
    };
  });

  const heldById = await heldSeatsByRole(db, roles);
  const taken = new Map(roles.map((r) => [r.slug, heldById.get(r.id) ?? 0]));

  const playerCount = players.length > 0 ? Math.ceil(players.length * READY_HEADROOM) : (config.playerCount ?? 80);
  return {
    players,
    roles: roles.map((r) => ({ ...r, spawnOnly: isSpawnOnly(r) })),
    taken,
    playerCount,
    leaderWhitelistEnabled: true,
  };
}

// What Preview shows and Start commits. Hand-set rows carry source "GM"; a re-roll replaces the lot with a new seed.
async function buildDraft(db, memberRoles, { seed = newSeed() } = {}) {
  const input = await loadAssignmentInput(db, memberRoles);
  const rolled = assignRoles({ ...input, seed });
  return {
    seed: rolled.seed,
    playerCount: input.playerCount,
    generatedAt: new Date().toISOString(),
    rows: rolled.rows,
    warnings: rolled.warnings,
  };
}

// Does the draft still fit the world? Returns a list of problems; empty means Start may commit.
async function validateDraft(db, draft) {
  const problems = [];
  if (!draft?.rows) return ["There is no preview to commit."];
  const [ready, roles] = await Promise.all([
    db.lobbyEntry.findMany({ where: { status: "READY" }, select: { discordUserId: true } }),
    db.role.findMany({ select: { id: true, slug: true, name: true, isUnique: true, unlimited: true, weight: true } }),
  ]);
  const readySet = new Set(ready.map((r) => r.discordUserId));
  const bySlug = new Map(roles.map((r) => [r.slug, r]));
  const drafted = new Set(draft.rows.map((r) => r.discordUserId));

  for (const id of readySet) if (!drafted.has(id)) problems.push("Somebody readied up after the preview.");
  for (const row of draft.rows) {
    if (!readySet.has(row.discordUserId)) problems.push("Somebody in the preview is no longer ready.");
    if (row.roleSlug && !bySlug.has(row.roleSlug)) problems.push(`${row.roleSlug} is no longer a role.`);
    if (row.roleSlug && isSpawnOnly(bySlug.get(row.roleSlug))) problems.push(`${bySlug.get(row.roleSlug).name} can only be spawned, never assigned.`);
  }

  const playerCount = draft.playerCount ?? 80;
  const wanted = new Map();
  for (const row of draft.rows) if (row.roleSlug) wanted.set(row.roleSlug, (wanted.get(row.roleSlug) ?? 0) + 1);
  const wantedRoles = [...wanted.keys()].map((slug) => bySlug.get(slug)).filter(Boolean);
  const heldById = await heldSeatsByRole(db, wantedRoles);
  for (const role of wantedRoles) {
    const count = wanted.get(role.slug);
    if ((heldById.get(role.id) ?? 0) + count > roleCapacity(role, playerCount)) {
      problems.push(`${role.name} no longer has room for ${count}.`);
    }
  }
  return [...new Set(problems)];
}

// Commits a validated draft: READY -> ASSIGNED/UNASSIGNED, game goes RUNNING,
// Turn 1 restamped to now. Re-validates under a lock on GameState so two
// Start clicks cannot both commit.
async function commitAssignment(db, draft, { actorDiscordUserId } = {}) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM "GameState" WHERE id = 1 FOR UPDATE`;
    const state = await tx.gameState.findUnique({ where: { id: 1 } });
    if (!ROLL_PHASES.has(state.phase)) throw new Error("NOT_LOBBY");
    const problems = await validateDraft(tx, draft);
    if (problems.length) {
      const err = new Error("DRAFT_STALE");
      err.problems = problems;
      throw err;
    }

    const config = await getGameConfig(tx);
    const roles = await tx.role.findMany({
      include: { faction: { select: { name: true } }, startingLocation: { include: { zone: { select: { name: true } } } } },
    });
    const bySlug = new Map(roles.map((r) => [r.slug, r]));
    const now = new Date();
    const expiresAt = new Date(now.getTime() + (config.creationWindowHours ?? 12) * 3600 * 1000);

    const assigned = [];
    const returned = [];
    for (const row of draft.rows) {
      const role = row.roleSlug ? bySlug.get(row.roleSlug) : null;
      if (role) {
        const entry = await tx.lobbyEntry.update({
          where: { discordUserId: row.discordUserId },
          data: { status: "ASSIGNED", assignedRoleId: role.id, assignedAt: now, expiresAt },
        });
        assigned.push({
          entryId: entry.id,
          discordUserId: row.discordUserId,
          roleName: role.name,
          factionName: role.faction?.name ?? null,
          zoneName: role.startingLocation?.zone?.name ?? null,
          expiresAt,
        });
      } else {
        await tx.lobbyEntry.update({
          where: { discordUserId: row.discordUserId },
          data: { status: "UNASSIGNED" },
        });
        returned.push({ discordUserId: row.discordUserId });
      }
    }

    await tx.gameState.update({
      where: { id: 1 },
      data: { phase: "RUNNING", startedAt: now, playerCount: draft.playerCount ?? null, assignmentDraft: null },
    });
    // Both stamps, not just gameDate: every Move deadline derives from startedAt (turnClock.js).
    const open = await tx.turn.findFirst({ where: { status: "OPEN" } });
    let turn;
    if (open) turn = await tx.turn.update({ where: { id: open.id }, data: { gameDate: now, startedAt: now } });
    else {
      // Turn.number is unique; a resolved Turn 1 with nothing open must not throw a constraint error.
      const last = await tx.turn.aggregate({ _max: { number: true } });
      turn = await tx.turn.create({ data: { number: (last._max.number ?? 0) + 1, phase: "DAWN", banner: pickTurnBanner("DAWN"), status: "OPEN", gameDate: now, startedAt: now } });
    }

    await tx.auditLog.create({
      data: {
        actorDiscordUserId: actorDiscordUserId ?? "system",
        actionType: "game_started",
        details: {
          seed: draft.seed,
          playerCount: draft.playerCount ?? null,
          assigned: assigned.length,
          returned: returned.length,
          rows: draft.rows,
        },
      },
    });

    return { assigned, returned, expiresAt, turn };
  });
}

// --- The DMs ----------------------------------------------------------------

function epoch(date) {
  return Math.floor(new Date(date).getTime() / 1000);
}

// First line is what Discord shows in the notification, so the seat is in
// it. `origin` is passed in because db/ must not know it (web/lib/auth.js).
function assignmentMessage({ roleName, factionName, zoneName, expiresAt }, origin) {
  const t = epoch(expiresAt);
  return [
    `**You're in. You are the ${roleName}.**`,
    [factionName ? `${factionName}.` : null, zoneName ? `You start in ${zoneName}.` : null].filter(Boolean).join(" "),
    `Build your character here: ${origin}/character`,
    `The seat is yours until <t:${t}:F> (<t:${t}:R>).`,
    "-# Can't make it? Free the seat up by pressing Decline.",
  ].join("\n");
}

function returnedMessage(origin) {
  return `No roles matching your preferences were available. The game has started, but you can still join at ${origin}/character.`;
}

function reminderMessage({ roleName, expiresAt }, origin) {
  const t = epoch(expiresAt);
  return `Your seat as ${roleName} is still waiting at ${origin}/character. It will become available to anyone <t:${t}:R>, at <t:${t}:F>.`;
}

function expiredMessage({ roleName }, origin) {
  return `Your seat as ${roleName} has been released. Late join is open at ${origin}/character.`;
}

function startedLine() {
  return "The game has begun.";
}

// Raw component JSON — the web sends this and only the bot has discord.js.
function declineComponents(entryId) {
  return [
    {
      type: 1,
      components: [{ type: 2, style: 2, custom_id: `${LOBBY_DECLINE_PREFIX}${entryId}`, label: "Decline the seat" }],
    },
  ];
}

// Stamps the assignment DM as delivered, so the sweep knows not to resend it.
async function markNotified(db, entryId) {
  await db.lobbyEntry.update({ where: { id: entryId }, data: { notifiedAt: new Date() } }).catch(() => {});
}

// A character arrived by ANY route (wizard, threat spawn), so an assigned
// seat is spent: recorded against the character, no longer held. Every
// character.create runs this in its transaction — otherwise a readied player
// who took a spawn instead would block their rolled seat for the whole
// window. READY too, not only ASSIGNED: a GM who readied up to test then
// pressed Skip kept a READY row, doubling their seat otherwise.
async function settleLobbyEntry(tx, discordUserId, characterId) {
  await tx.lobbyEntry.updateMany({
    where: { discordUserId, status: { in: ["READY", "ASSIGNED"] } },
    data: { status: "CREATED", characterId },
  });
}

// The seat is free the moment the status changes — capacity counts only ASSIGNED rows (seatCount.js).
async function declineAssignment(db, entryId, discordUserId) {
  const entry = await db.lobbyEntry.findUnique({ where: { id: entryId }, include: { assignedRole: { select: { name: true } } } });
  if (!entry) return { ok: false, reason: "That seat's gone." };
  if (entry.discordUserId !== discordUserId) return { ok: false, reason: "That's not yours to answer." };
  if (entry.status === "CREATED") return { ok: false, reason: "You already built the character." };
  if (entry.status !== "ASSIGNED") return { ok: false, reason: "That seat was already released." };
  await db.lobbyEntry.update({ where: { id: entry.id }, data: { status: "DECLINED" } });
  await db.auditLog
    .create({
      data: {
        actorDiscordUserId: discordUserId,
        actionType: "lobby_seat_declined",
        details: { entryId: entry.id, role: entry.assignedRole?.name ?? null },
      },
    })
    .catch((err) => console.error("Lobby decline audit failed:", err));
  return { ok: true, line: "You turned the seat down. Late join is open." };
}

module.exports = {
  LOBBY_DECLINE_PREFIX,
  ROLL_PHASES,
  buildDraft,
  commitAssignment,
  assignmentMessage,
  returnedMessage,
  reminderMessage,
  expiredMessage,
  startedLine,
  declineComponents,
  declineAssignment,
  markNotified,
  settleLobbyEntry,
};
