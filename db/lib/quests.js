// Quests: a piece of content a GM stages at runtime, anywhere on the map, without a YAML edit and without a deploy. See docs/systemdocs/QUESTS.md.
// A quest mints ONE Room at an existing Location with a single Interact button; pressing it files the presser's Move for the turn as a Gambit —
// deliberately the whole mechanic, so staging one adds no new economy and no new ration. The Room is the only one docs/zones.yaml does not master
// (Room.questId exists so syncZones.js's stale-room prune skips it) — otherwise an ordinary Room. Takes `prisma`, deliberately not on the @lifeweb/db barrel.
const { deleteThread } = require("./discordRest");
const { syncRoomThread } = require("./syncZones");
const { syncCharacterRoomAccess, questAllowedRoomIds } = require("./roomAccess");
const { roomLine } = require("./placeLine");
const { expiryFrom } = require("./turnFormat");
const { fileMove } = require("./moves");
const {
  QUEST_INTERACT_PREFIX,
  QUEST_MODAL_PREFIX,
  QUEST_INTENTION_FIELD,
  INTERACT_PROMPT,
  ALREADY_MOVED,
  TITLE_MAX,
  DESCRIPTION_MAX,
  INTENTION_MAX,
} = require("./questText");

// Quest rooms sort after every authored room at their Location. The YAML's
// sortOrder is small and hand-assigned, so this cannot collide with one.
const QUEST_SORT_ORDER = 9000;

function questRoomKind({ accessTagSlugs, allowedCharacterIds }) {
  return accessTagSlugs.length > 0 || allowedCharacterIds.length > 0 ? "PRIVATE" : "PUBLIC";
}

function cleanList(value) {
  return [...new Set((Array.isArray(value) ? value : []).map((v) => String(v).trim()).filter(Boolean))];
}

// How many turns a quest has left, or null when it stands until closed. Shared with the GM panel.
function turnsRemaining(quest, currentTurnNumber) {
  if (quest?.expiresTurn == null || currentTurnNumber == null) return null;
  return quest.expiresTurn - currentTurnNumber + 1;
}

async function openTurnNumber(prisma) {
  const turn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { number: true } });
  return turn?.number ?? null;
}

// Everything syncRoomThread needs, plus what roomAffordances reads to decide the Interact button is there at all.
const ROOM_SELECT = {
  id: true,
  slug: true,
  name: true,
  description: true,
  kind: true,
  live: true,
  questId: true,
  locationId: true,
  discordThreadId: true,
  starterMessageId: true,
  postHash: true,
};

async function locationFor(prisma, locationId) {
  return prisma.location.findUnique({
    where: { id: locationId },
    select: { id: true, name: true, discordChannelId: true },
  });
}

// Push the room's thread and starter post. Swallowed on purpose — a quest that could not reach Discord is still a quest on the web; the channel doctor is the backstop.
async function pushRoom(prisma, room, location) {
  if (!location?.discordChannelId) return "skipped";
  try {
    return await syncRoomThread(prisma, room, location, null, null);
  } catch (err) {
    console.error(`Quest room push failed ("${room.name}"):`, err.message ?? err);
    return "failed";
  }
}

// Everyone the quest's door state could have changed for, and ONLY them — the union of the old and new gates, since a full sweep would be 100+ recomputes.
// A PUBLIC quest room needs no membership (Discord gates a public thread on its parent channel via the Location overwrite already).
async function resyncAccess(prisma, before, after) {
  const names = new Set([...(before?.allowedCharacterIds ?? []), ...(after?.allowedCharacterIds ?? [])]);
  const slugs = [...new Set([...(before?.accessTagSlugs ?? []), ...(after?.accessTagSlugs ?? [])])];
  if (names.size === 0 && slugs.length === 0) return;

  const where = { status: "ALIVE", OR: [] };
  if (names.size > 0) where.OR.push({ id: { in: [...names] } });
  if (slugs.length > 0) where.OR.push({ tags: { some: { tag: { slug: { in: slugs } } } } });

  const characters = await prisma.character.findMany({
    where,
    select: { id: true, discordUserId: true, locationId: true, status: true },
  });
  for (const character of characters) {
    await syncCharacterRoomAccess(prisma, character).catch((err) =>
      console.error(`Quest access sync failed for ${character.id}:`, err.message ?? err),
    );
  }
}

// Stage one. Returns { ok: true, quest } or { ok: false, error }.
async function createQuest(
  prisma,
  { title, description, locationId, expiresTurns, accessTagSlugs, allowedCharacterIds, createdById },
) {
  const name = String(title ?? "").trim().slice(0, TITLE_MAX);
  if (!name) return { ok: false, error: "Give the quest a title." };
  const body = String(description ?? "").trim().slice(0, DESCRIPTION_MAX);

  const location = await locationFor(prisma, locationId);
  if (!location) return { ok: false, error: "Pick a place for it first." };

  const tags = cleanList(accessTagSlugs);
  const allowed = cleanList(allowedCharacterIds);
  const turnNumber = await openTurnNumber(prisma);
  const duration = Number(expiresTurns);

  const quest = await prisma.quest.create({
    data: {
      title: name,
      description: body,
      locationId: location.id,
      createdTurn: turnNumber,
      // Null when no turn is open: stands until somebody closes it by hand.
      expiresTurn: Number.isFinite(duration) && duration > 0 ? expiryFrom(turnNumber, duration) : null,
      createdById: createdById ?? null,
      accessTagSlugs: tags,
      allowedCharacterIds: allowed,
    },
  });

  const room = await prisma.room.create({
    data: {
      // The quest id IS the slug's uniqueness.
      slug: `quest-${quest.id}`,
      name: name.slice(0, 100),
      description: body,
      kind: questRoomKind({ accessTagSlugs: tags, allowedCharacterIds: allowed }),
      accessTagSlugs: tags,
      locationId: location.id,
      sortOrder: QUEST_SORT_ORDER,
      questId: quest.id,
    },
    select: ROOM_SELECT,
  });

  await pushRoom(prisma, room, location);
  await resyncAccess(prisma, null, quest);
  return { ok: true, quest: await prisma.quest.findUnique({ where: { id: quest.id } }) };
}

// Edit one. The starter message is rewritten IN PLACE by syncRoomThread's hash path — never reposted, since a repost pings every thread follower.
async function updateQuest(prisma, questId, patch = {}) {
  const quest = await prisma.quest.findUnique({ where: { id: questId }, include: { room: true } });
  if (!quest) return { ok: false, error: "That quest is gone." };

  const data = {};
  if (patch.title !== undefined) {
    const name = String(patch.title).trim().slice(0, TITLE_MAX);
    if (!name) return { ok: false, error: "Give the quest a title." };
    data.title = name;
  }
  if (patch.description !== undefined) data.description = String(patch.description).trim().slice(0, DESCRIPTION_MAX);
  if (patch.accessTagSlugs !== undefined) data.accessTagSlugs = cleanList(patch.accessTagSlugs);
  if (patch.allowedCharacterIds !== undefined) data.allowedCharacterIds = cleanList(patch.allowedCharacterIds);
  if (patch.expiresTurns !== undefined) {
    const duration = Number(patch.expiresTurns);
    // Re-based on the CURRENT turn: "three more days" means from today, not from when it was staged.
    const turnNumber = await openTurnNumber(prisma);
    data.expiresTurn = Number.isFinite(duration) && duration > 0 ? expiryFrom(turnNumber, duration) : null;
  }

  const next = await prisma.quest.update({ where: { id: questId }, data });

  if (quest.room) {
    const kind = questRoomKind(next);
    const room = await prisma.room.update({
      where: { id: quest.room.id },
      data: {
        name: next.title.slice(0, 100),
        description: next.description,
        accessTagSlugs: next.accessTagSlugs,
        kind,
      },
      select: ROOM_SELECT,
    });
    // A thread cannot change public/private after creation — recreate it, like syncZones.js does, or the door silently stays as it was.
    if (kind !== quest.room.kind && room.discordThreadId) {
      await deleteThread(room.discordThreadId).catch(() => {});
      await prisma.room.update({
        where: { id: room.id },
        data: { discordThreadId: null, starterMessageId: null, postHash: null },
      });
      room.discordThreadId = null;
      room.starterMessageId = null;
      room.postHash = null;
    }
    await pushRoom(prisma, room, await locationFor(prisma, room.locationId));
  }

  await resyncAccess(prisma, quest, next);
  return { ok: true, quest: next };
}

// Shut one. The room goes; the record stays. `status` is CLOSED (a GM said so) or EXPIRED (the clock did) — kept apart for the GM asking a week later.
async function closeQuest(prisma, questId, { status = "CLOSED" } = {}) {
  const quest = await prisma.quest.findUnique({ where: { id: questId }, include: { room: true } });
  if (!quest) return { ok: false, error: "That quest is gone." };
  if (quest.status !== "OPEN") return { ok: true, quest };

  // Spoken before the thread is deleted so anybody sitting in it sees why. Scenery, so it can't take the close down with it.
  if (quest.room?.discordThreadId) {
    await roomLine(prisma, quest.room, "Whatever was happening here is over.").catch(() => {});
  }

  if (quest.room) {
    if (quest.room.discordThreadId) await deleteThread(quest.room.discordThreadId).catch(() => {});
    await prisma.room.delete({ where: { id: quest.room.id } }).catch((err) =>
      console.error(`Quest room delete failed (${questId}):`, err.message ?? err),
    );
  }

  const next = await prisma.quest.update({
    where: { id: questId },
    data: { status, closedAt: new Date() },
  });
  return { ok: true, quest: next };
}

// The clock. Runs beside the noticeboard sweep in db/index.js.
async function expireQuestsPass(prisma, turnNumber) {
  if (turnNumber == null) return { closed: 0 };
  let closed = 0;
  try {
    const due = await prisma.quest.findMany({
      where: { status: "OPEN", expiresTurn: { lte: turnNumber } },
      select: { id: true },
    });
    for (const { id } of due) {
      const result = await closeQuest(prisma, id, { status: "EXPIRED" }).catch((err) => {
        console.error(`Quest expiry failed (${id}):`, err.message ?? err);
        return null;
      });
      if (result?.ok) closed += 1;
    }
  } catch (err) {
    console.error("Quest expiry pass failed:", err.message ?? err);
  }
  return { closed };
}

// Somebody pressed Interact. Every gate is re-run here rather than trusted from wherever the button was drawn — a hidden button is a hint, not a lock.
// `character` needs { id, status, zoneId, locationId, discordUserId }.
async function questInteract(prisma, { questId, character, intention, actorDiscordUserId }) {
  const said = String(intention ?? "").trim().slice(0, INTENTION_MAX);
  if (!said) return { ok: false, error: "Say what you're trying to do first." };
  if (!character || character.status !== "ALIVE") return { ok: false, error: "You don't have a living character." };

  const quest = await prisma.quest.findUnique({ where: { id: questId }, include: { room: true } });
  if (!quest || quest.status !== "OPEN") return { ok: false, error: "That's over." };
  if (character.locationId !== quest.locationId) return { ok: false, error: "You aren't there any more." };

  // The same two doors accessibleRooms() reads, asked directly since the room may be PUBLIC, in which case there is nothing to ask.
  if (questRoomKind(quest) === "PRIVATE") {
    const allowedByName = quest.allowedCharacterIds.includes(character.id);
    let allowedByKey = false;
    if (!allowedByName && quest.accessTagSlugs.length > 0) {
      const held = await prisma.characterTag.findFirst({
        where: { characterId: character.id, tag: { slug: { in: quest.accessTagSlugs } } },
        select: { id: true },
      });
      allowedByKey = Boolean(held);
    }
    if (!allowedByName && !allowedByKey) return { ok: false, error: "This isn't yours to touch." };
  }

  // The one-Move-a-turn rule, asked before fileMove so the refusal reads as the quest's own sentence — fileMove's @@unique([characterId, turnId]) is the real gate underneath both.
  const openTurn = await prisma.turn.findFirst({ where: { status: "OPEN" }, select: { id: true } });
  if (!openTurn) return { ok: false, error: "Your turn isn't open — nothing was recorded." };
  const already = await prisma.action.findFirst({
    where: { characterId: character.id, turnId: openTurn.id },
    select: { id: true },
  });
  if (already) return { ok: false, error: ALREADY_MOVED };

  const filed = await fileMove(prisma, {
    character,
    actorDiscordUserId: actorDiscordUserId ?? character.discordUserId ?? null,
    moveKind: "GAMBIT",
    description: `${quest.title} — ${said}`,
  });
  // A Move filed between the check above and here is the race the unique index catches; it comes back as fileMove's own refusal.
  if (!filed.ok) return { ok: false, error: filed.error };

  await prisma.questInteraction
    .create({
      data: {
        questId: quest.id,
        characterId: character.id,
        actionId: filed.action.id,
        turnId: filed.openTurn.id,
        intention: said,
      },
    })
    .catch((err) => console.error(`Quest interaction row failed (${quest.id}):`, err.message ?? err));

  await prisma.auditLog
    .create({
      data: {
        actorDiscordUserId: actorDiscordUserId ?? character.discordUserId ?? null,
        actionType: "quest_interact",
        targetCharacterId: character.id,
        // Three per-turn rations count audit rows (REQUESTS.md §1a).
        turnId: filed.openTurn.id,
        details: { questId: quest.id, title: quest.title, actionId: filed.action.id },
      },
    })
    .catch(() => {});

  // The room hears that somebody moved, never what they said — that's between them and the GM until the push.
  if (quest.room) {
    await roomLine(prisma, quest.room, "Somebody sets to work.").catch(() => {});
  }

  return { ok: true, action: filed.action, quest };
}

module.exports = {
  QUEST_INTERACT_PREFIX,
  QUEST_MODAL_PREFIX,
  QUEST_INTENTION_FIELD,
  INTERACT_PROMPT,
  ALREADY_MOVED,
  TITLE_MAX,
  DESCRIPTION_MAX,
  INTENTION_MAX,
  questRoomKind,
  turnsRemaining,
  questAllowedRoomIds,
  createQuest,
  updateQuest,
  closeQuest,
  expireQuestsPass,
  questInteract,
};
