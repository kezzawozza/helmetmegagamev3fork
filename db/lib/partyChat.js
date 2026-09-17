// PARTY CHAT — one private thread per party, hung off the parent channel named
// by GameConfig.partyChannelId, under the Gameplay category. Membership is a
// projection of the escort chain (db/lib/escort.js): everyone with
// escortedById = leader.id is a party member, plus the leader themselves.
//
// Keyed on the ORIGINAL CREATOR's character (PartyThread.creatorCharacterId is
// @unique), so the name is frozen at first creation even if leadership shifts,
// and one leader has at most one party thread live at a time.
//
// Lifecycle: `ensurePartyThreadFor` opens it when a leader first picks somebody
// up. `syncPartyMembership` reconciles rows and Discord thread members after
// each escort mutation and after each leader move. `teardownPartyThread`
// deletes the Discord thread and the row when the party dissolves.
//
// Bleed: the whisper poll picks a random public Room in the leader's current
// Location and drops a fragment there. This module owns the room-picker; the
// poll (bot/src/lib/whisperPoll.js) walks the rows and does the aliasing.
//
// Takes `prisma` as a parameter, off the @lifeweb/db barrel like db/lib/dm.js —
// require it by path. REST only, best-effort: the doctor is the safety net.
const {
  startPrivateThread,
  addThreadMember,
  removeThreadMember,
  deleteThread,
} = require("./discordRest");
const { concealedAlias } = require("./concealedIdentity");
const { formatBareName } = require("./characterName");
const { partyOf } = require("./escort");

// The name goes on the Discord thread and the web place both. Frozen at
// creation from the creator character; concealed leaders get their hooded
// noun-phrase, everyone else gets the bare name.
function partyName(creator) {
  const alias = creator?.concealed
    ? concealedAlias({ age: creator.age, gender: creator.gender })
    : formatBareName({ firstName: creator?.firstName, lastName: creator?.lastName });
  const safe = String(alias || "Someone").trim();
  // Discord thread names cap at 100. "'s Party" is 8, so 90 leaves headroom.
  return `${safe.slice(0, 90)}'s Party`;
}

async function partyParentChannelId(prisma) {
  const config = await prisma.gameConfig.findUnique({
    where: { id: 1 },
    select: { partyChannelId: true },
  });
  return config?.partyChannelId ?? null;
}

// Load the leader row shape this module needs — enough for the name, and the
// current location for the bleed.
async function loadLeader(prisma, leaderId) {
  return prisma.character.findUnique({
    where: { id: leaderId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      concealed: true,
      age: true,
      gender: true,
      locationId: true,
      discordUserId: true,
      discordMirrored: true,
    },
  });
}

// Idempotent: returns the PartyThread row for a leader, opening one on Discord
// if this is the first attach. `leader` may be an id or a row. Returns null
// when the leader is not currently carrying anybody — a leaderless "party" is
// nothing.
async function ensurePartyThreadFor(prisma, leader) {
  const leaderId = typeof leader === "string" ? leader : leader?.id;
  if (!leaderId) return null;
  const existing = await prisma.partyThread.findUnique({
    where: { creatorCharacterId: leaderId },
  });
  if (existing) return existing;

  const party = await partyOf(prisma, leaderId);
  if (party.length === 0) return null;

  const leaderRow = typeof leader === "object" && leader?.firstName
    ? leader
    : await loadLeader(prisma, leaderId);
  if (!leaderRow) return null;

  const parentId = await partyParentChannelId(prisma);
  if (!parentId) {
    console.warn("Party chat: no partyChannelId set — skipping thread open.");
    return null;
  }

  const name = partyName(leaderRow);
  let thread;
  try {
    thread = await startPrivateThread(parentId, name);
  } catch (err) {
    console.error(`Failed to open party thread for ${leaderRow.name ?? leaderId}:`, err);
    return null;
  }

  return prisma.partyThread.create({
    data: {
      threadId: thread.id,
      name,
      creatorCharacterId: leaderId,
      currentLocationId: leaderRow.locationId ?? null,
    },
  });
}

// Reconcile PartyThreadMember rows and the Discord thread's member list
// against the current escort chain. Call this after every escort mutation
// (attach, detach, releaseParty) and after the leader moves.
async function syncPartyMembership(prisma, leader) {
  const leaderId = typeof leader === "string" ? leader : leader?.id;
  if (!leaderId) return null;

  const party = await partyOf(prisma, leaderId);
  if (party.length === 0) {
    return teardownPartyThread(prisma, leaderId);
  }

  const thread = await ensurePartyThreadFor(prisma, leader);
  if (!thread) return null;

  const leaderRow = await loadLeader(prisma, leaderId);
  if (leaderRow && leaderRow.locationId !== thread.currentLocationId) {
    await prisma.partyThread.update({
      where: { id: thread.id },
      data: { currentLocationId: leaderRow.locationId ?? null },
    });
    thread.currentLocationId = leaderRow.locationId ?? null;
  }

  // Wanted membership: the leader plus everyone escorted by them.
  const wanted = new Map();
  if (leaderRow) wanted.set(leaderRow.id, leaderRow);
  for (const member of party) wanted.set(member.id, member);

  const existing = await prisma.partyThreadMember.findMany({
    where: { partyThreadId: thread.id },
    select: { characterId: true },
  });
  const existingIds = new Set(existing.map((r) => r.characterId));

  // Load discord ids in one shot for every id on either side.
  const allIds = new Set([...wanted.keys(), ...existingIds]);
  const discordRows = await prisma.character.findMany({
    where: { id: { in: [...allIds] } },
    select: { id: true, discordUserId: true, discordMirrored: true },
  });
  const discord = new Map(discordRows.map((r) => [r.id, r]));

  // Add newcomers.
  for (const [id, _row] of wanted) {
    if (existingIds.has(id)) continue;
    await prisma.partyThreadMember
      .create({ data: { partyThreadId: thread.id, characterId: id } })
      .catch(() => {});
    const d = discord.get(id);
    if (d?.discordUserId && d.discordMirrored) {
      await addThreadMember(thread.threadId, d.discordUserId).catch(() => {});
    }
  }

  // Drop those who left. The LEADER themselves is always in `wanted`, so this
  // never drops them.
  for (const id of existingIds) {
    if (wanted.has(id)) continue;
    await prisma.partyThreadMember
      .deleteMany({ where: { partyThreadId: thread.id, characterId: id } })
      .catch(() => {});
    const d = discord.get(id);
    if (d?.discordUserId) {
      await removeThreadMember(thread.threadId, d.discordUserId).catch(() => {});
    }
  }

  return thread;
}

// Delete the Discord thread and the row. Idempotent — safe to call for a
// leader who never had one, or twice.
async function teardownPartyThread(prisma, leader) {
  const leaderId = typeof leader === "string" ? leader : leader?.id;
  if (!leaderId) return null;
  const row = await prisma.partyThread.findUnique({
    where: { creatorCharacterId: leaderId },
  });
  if (!row) return null;
  await deleteThread(row.threadId).catch((err) => {
    // 404 is the ok case — the thread is already gone.
    if (err?.status !== 404) console.error(`Party thread delete for ${row.threadId} failed:`, err);
  });
  await prisma.partyThread.delete({ where: { id: row.id } }).catch(() => {});
  return null;
}

// Pick a random public Room in the party's current Location. Returns null if
// none. Used by the whisper poll.
async function pickRandomPublicRoom(prisma, locationId) {
  if (!locationId) return null;
  const rooms = await prisma.room.findMany({
    where: {
      locationId,
      kind: "PUBLIC",
      retiredAt: null,
      discordThreadId: { not: null },
    },
    select: { id: true, discordThreadId: true },
  });
  if (rooms.length === 0) return null;
  return rooms[Math.floor(Math.random() * rooms.length)];
}

module.exports = {
  partyName,
  partyParentChannelId,
  ensurePartyThreadFor,
  syncPartyMembership,
  teardownPartyThread,
  pickRandomPublicRoom,
};
