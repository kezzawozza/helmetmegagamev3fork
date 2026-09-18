// Everything the Oracle reads, turned into one text block per zone. See docs/systemdocs/ORACLE.md.
// This module is the whole of the Oracle's access to game state, deliberately, so what a correspondent may see is answerable by reading one file.
// Three things here are easy to get wrong, commented where they happen: the turn window runs lock to lock (derived, not read off AuditLog's turnId), tags are filtered to the two categories that actually move, and a concealed character is written with both faces.

const { auditLinesFor, AGGREGATE } = require("./oracleAudit");
const { moveCutoffAt, TURN_CLOCK_SELECT } = require("./turnClock");
const {
  CONCEALMENT_TAG_FIELDS,
  forcedNameFrom,
  concealmentFrom,
  presentedIdentity,
} = require("./presentedIdentity");
const { PARTIES } = require("./threats");
const { listObjectives, membersByParty } = require("./objectives");

// The only two tag categories worth re-reading every turn — Beliefs and Skills are bought at creation and never move, so shipping the whole catalog would pay repeatedly for a constant. Health/status DO move (injuries, mood band, Tipsy, Ate Meal); everything else reaches the Oracle as a CHANGE through the audit lines.
const LIVE_TAG_CATEGORIES = ["health", "status"];

// ArchiveEntry kinds that are events rather than speech; already turn-stamped, unlike AuditLog rows.
const BEAT_KINDS = ["DEATH", "CHARACTER_CREATED", "DESIRE_FULFILLED", "LIFEWEB", "TRAVEL"];

// The turn's wall-clock window, LOCK TO LOCK. Derived because AuditLog.turnId is NULL on most rows (it's for per-turn rations, not a general stamp — /gm/audit derives the same way); filtering on turnId would silently return almost nothing.
// Cutoff to cutoff, not start to end: turn N's page is written at N's Move cutoff, so the three hours after it belong to N+1's page, the first one written after they happened. The floor is the last turn actually CHRONICLED, not simply the last turn — moveCutoffAt() can't tell a frozen/short turn apart, so anchoring on the last turn WITH a page keeps frozen days inside the next real page's window instead of reading as already covered.
// The clamp: a turn opened at 23:00 ends at midnight, so its derived cutoff (21:00) is BEFORE it began — left alone that pulls the floor backwards and double-chronicles an evening. Pure, so all of this is testable without a database.
function windowBetween(anchorTurn, turn) {
  const to = moveCutoffAt(turn) ?? new Date();
  if (!anchorTurn) return { from: turn.startedAt, to };
  const cutoff = moveCutoffAt(anchorTurn);
  const startedAt = new Date(anchorTurn.startedAt);
  const from = cutoff && cutoff > startedAt ? cutoff : startedAt;
  return { from, to };
}

async function turnWindow(prisma, turn) {
  // The newest earlier turn that has a page, falling through to any earlier turn when the Oracle has never run — enabling it mid-game should not make its first page a chronicle of the entire game.
  const anchor =
    (await prisma.turn.findFirst({
      where: { number: { lt: turn.number }, oraclePages: { some: {} } },
      orderBy: { number: "desc" },
      select: { number: true, ...TURN_CLOCK_SELECT },
    })) ??
    (await prisma.turn.findFirst({
      where: { number: { lt: turn.number } },
      orderBy: { number: "desc" },
      select: { number: true, ...TURN_CLOCK_SELECT },
    }));
  return windowBetween(anchor, turn);
}

// How the Oracle refers to somebody. ORACLE.md: real names, with the mask annotated — a GM needs to know both that it was Bram and that the room didn't know that; the true name alone hides the disguise, the alias alone makes a character impossible to follow.
function displayName(character) {
  const tags = character.tags ?? [];
  const presented = presentedIdentity(character, {
    forcedName: forcedNameFrom(tags),
    concealment: concealmentFrom(tags),
  });
  if (presented.name && presented.name !== character.name) {
    return `${character.name} (seen as "${presented.name}")`;
  }
  return character.name;
}

function liveTagNames(character) {
  return (character.tags ?? [])
    .filter((row) => LIVE_TAG_CATEGORIES.includes(row.tag?.category))
    .map((row) => (row.quantity > 1 ? `${row.tag.name} ×${row.quantity}` : row.tag.name));
}

// One Move as one line. diceRoll and diceModifier are kept apart in the schema on purpose (a GM must tell a natural 5 from a modified one), so they're reported apart here too.
function moveLine(action, name) {
  const bits = [`${name} | ${action.moveKind ?? "MOVE"}`];
  if (action.diceRoll != null) {
    const modified = action.diceRoll + (action.diceModifier ?? 0);
    bits.push(
      action.diceModifier ? `die ${action.diceRoll} -> ${modified} (${action.diceModifier})` : `die ${action.diceRoll}`,
    );
  }
  if (action.laborTier) bits.push(`tier ${action.laborTier}`);
  if (action.resourceDelta != null) bits.push(`${action.resourceDelta} ⬢`);
  if (action.location?.name) bits.push(action.location.name);
  bits.push(action.moveReviewStatus === "SOLVED" ? "solved" : "unsolved");
  return `${bits.join(" | ")}\n  "${String(action.description ?? "").replace(/\s+/g, " ").trim()}"`;
}

// A StagedEffect's `appliedEffect` snapshot into one line, same posture as db/lib/moveEffects.js#describeMoveEffects: short and deterministic, silently skipping a key it doesn't recognise rather than throwing.
function describeStagedEffect(snapshot) {
  const bits = [];
  if (Number.isInteger(snapshot?.resources) && snapshot.resources !== 0) {
    bits.push(`${snapshot.resources > 0 ? "+" : ""}${snapshot.resources} ⬢`);
  }
  if (Number.isInteger(snapshot?.tagPoints) && snapshot.tagPoints !== 0) {
    bits.push(`${snapshot.tagPoints > 0 ? "+" : ""}${snapshot.tagPoints} tag pts`);
  }
  if (Array.isArray(snapshot?.tags) && snapshot.tags.length) {
    const granted = snapshot.tags.filter((t) => t.op === "add").map((t) => t.name);
    const removed = snapshot.tags.filter((t) => t.op === "remove").map((t) => t.name);
    if (granted.length) bits.push(`granted ${granted.join(", ")}`);
    if (removed.length) bits.push(`removed ${removed.join(", ")}`);
  }
  if (snapshot?.location) bits.push("relocated");
  if (snapshot?.transfer) bits.push(`${snapshot.transfer.amount} ⬢ transferred`);
  return bits.join(", ");
}

// Load once, slice per zone: six queries for the whole turn rather than six per zone, since the correspondents run in parallel and would stampede the pool during turn rollover. Maps zoneId -> its seat zone's id for every zone, since presence is finer than the seats a GM/correspondent is scoped to (`db/lib/seatZone.js`) — `caves`/`depths` are CHILD zones of the seat `underground`.
// `seatZone.js` claims every writer stamps the seat id, but the live data disagrees (most Action rows carry the raw presence zoneId), so this file resolves defensively: every zoneId comparison below goes through this map first. A future raw `zoneId === zone.id` comparison will quietly lose the cave levels.
async function loadSeatByZoneId(prisma) {
  const zones = await prisma.zone.findMany({ select: { id: true, seatZoneId: true } });
  return new Map(zones.map((z) => [z.id, z.seatZoneId ?? z.id]));
}

// `seatByZoneId` is optional so this stays safe against a caller/fixture that never built one; a map is expected once `material` comes from `loadTurnMaterial`.
function resolveSeat(zoneId, seatByZoneId) {
  return seatByZoneId?.get(zoneId) ?? zoneId;
}

async function loadTurnMaterial(prisma, turn, { includeChat = false } = {}) {
  const window = await turnWindow(prisma, turn);
  const seatByZoneId = await loadSeatByZoneId(prisma);

  const characters = await prisma.character.findMany({
    where: { status: "ALIVE" },
    select: {
      id: true,
      name: true,
      discordUserId: true,
      concealed: true,
      zoneId: true,
      locationId: true,
      zone: { select: { id: true, name: true } },
      location: { select: { name: true } },
      role: { select: { name: true } },
      faction: { select: { name: true } },
      tags: {
        select: {
          quantity: true,
          equipped: true,
          // slug is `membersByParty`'s own admission ticket (db/lib/objectives.js) — how a character is recognised as sitting a threat seat, for the Threats correspondent below.
          tag: { select: { ...CONCEALMENT_TAG_FIELDS, category: true, slug: true } },
        },
      },
    },
  });

  // Who sits a threat seat and which party they answer for — the same helper the end-of-game reveal uses (db/lib/objectives.js), so this page can never disagree with `/gm/dev?s=antagonists`. Objectives are read only for a party with someone seated: an unseated party "never existed in play" (buildAntagonistReveal's rule).
  const threatMembers = membersByParty(characters);
  const objectivesByParty = new Map(
    await Promise.all(
      PARTIES.filter((p) => threatMembers.has(p.key)).map(async (p) => [
        p.key,
        await listObjectives(prisma, { partyKey: p.key }),
      ]),
    ),
  );

  const [actions, auditRows, beats, chat, stagedMessages, stagedEffects, spawns, rites] = await Promise.all([
    // Moves go by the WINDOW, not turnId: the auto-labor pass files a Move for everybody who filed none, at the PUSH — three hours after N's page is written (db/lib/autoLaborPass.js). Stamped turnId N but created after N's page exists, so on the FK it would appear in no page ever. The window catches it in N+1. A player's own Move is unaffected — filed before the lock, so it lands in its own window either way.
    prisma.action.findMany({
      where: { createdAt: { gte: window.from, lt: window.to } },
      select: {
        id: true,
        characterId: true,
        zoneId: true,
        description: true,
        moveKind: true,
        moveReviewStatus: true,
        diceRoll: true,
        diceModifier: true,
        resourceDelta: true,
        laborTier: true,
        location: { select: { name: true } },
      },
    }),
    prisma.auditLog.findMany({
      where: { createdAt: { gte: window.from, lt: window.to } },
      orderBy: { createdAt: "asc" },
      select: {
        actionType: true,
        actorDiscordUserId: true,
        targetCharacterId: true,
        details: true,
      },
    }),
    // Beats and chat go by the WINDOW, not turnNumber: an entry stamped N but sent after N's lock doesn't exist yet when N's page is written, and a page keyed on N+1 would never look for it. The window is the authority; the stamp is not.
    // sentAt, not createdAt: every index is on sentAt, so filtering on createdAt would put a sequential scan of the whole transcript on this path once a turn.
    prisma.archiveEntry.findMany({
      where: { sentAt: { gte: window.from, lt: window.to }, kind: { in: BEAT_KINDS } },
      orderBy: { sentAt: "asc" },
      select: { kind: true, zoneId: true, content: true, characterName: true },
    }),
    includeChat
      ? prisma.archiveEntry.findMany({
          where: { sentAt: { gte: window.from, lt: window.to }, kind: "MESSAGE" },
          orderBy: { sentAt: "asc" },
          select: { zoneId: true, characterName: true, concealedAlias: true, content: true },
        })
      : Promise.resolve([]),
    // A GM's own turn narration (ADJUDICATION.md §1), same reasoning as the Move comment above: staged during N's window, sent at N's push, so it belongs to N+1's window. Read by sentAt, same column stagedPush.js stamps on delivery, so an undelivered row is correctly invisible.
    // PUBLIC and PRIVATE are both read: a PRIVATE row went out as a DM with no other trace, and this is a GM tool query, not a player-facing feed, so the privacy argument that keeps it off chat/archive doesn't apply here.
    prisma.stagedMessage.findMany({
      where: { sentAt: { gte: window.from, lt: window.to } },
      select: {
        kind: true,
        content: true,
        zoneId: true,
        recipients: { select: { character: { select: { id: true, zoneId: true } } } },
      },
    }),
    // The mechanical half of the same tray (StagedEffect, ADJUDICATION.md §1); `appliedAt` is the delivery stamp, same window logic as the narration query. `targetCharacterId` is nullable only for a Room -> Room transfer, dropped here for having no character to place it against.
    prisma.stagedEffect.findMany({
      where: { appliedAt: { gte: window.from, lt: window.to } },
      select: {
        targetCharacterId: true,
        appliedEffect: true,
        targetCharacter: { select: { zoneId: true, name: true } },
      },
    }),
    // The one lifecycle table with no audit row of its own — createdAt catches an offer made this window, resolvedAt catches one resolved in it. A spawn can appear twice across two windows, correctly, since each half is its own event.
    prisma.threatSpawn.findMany({
      where: {
        OR: [
          { createdAt: { gte: window.from, lt: window.to } },
          { resolvedAt: { gte: window.from, lt: window.to } },
        ],
      },
      select: { threatSlug: true, status: true, discordUserId: true, role: { select: { name: true } } },
    }),
    prisma.riteAttempt.findMany({
      where: { firedAt: { gte: window.from, lt: window.to } },
      select: { riteKey: true, roomName: true, status: true, result: true },
    }),
  ]);

  const names = {
    byCharacterId: new Map(),
    byDiscordUserId: new Map(),
  };
  for (const character of characters) {
    const label = displayName(character);
    names.byCharacterId.set(character.id, label);
    if (character.discordUserId) names.byDiscordUserId.set(character.discordUserId, label);
  }

  return {
    window,
    characters,
    actions,
    auditRows,
    beats,
    chat,
    stagedMessages,
    stagedEffects,
    seatByZoneId,
    names,
    threatMembers,
    objectivesByParty,
    spawns,
    rites,
  };
}

// The audit rows one zone's page is built from. An audit row carries no zone, so it's placed by its ACTOR's current position — approximate (somebody could act in Town then walk to the Fortress), but the alternative is a row appearing in no zone's input at all.
function auditRowsForZone(material, zone) {
  const here = material.characters.filter((c) => resolveSeat(c.zoneId, material.seatByZoneId) === zone.id);
  const hereIds = new Set(here.map((c) => c.id));
  return material.auditRows.filter((row) => {
    const actor = here.find((c) => c.discordUserId === row.actorDiscordUserId);
    return Boolean(actor) || (row.targetCharacterId && hereIds.has(row.targetCharacterId));
  });
}

// Which once-a-turn lines each zone must NOT report — the map runOracle hands to the six calls, one Set each. "Hunger was charged" is true of the whole game, not a zone, so exactly one page says it: the claim is settled here, up front, since the six correspondents run at once and cannot thread a mutable Set between them.
// Zones are walked in the order runOracle has them, and the first one holding a row of that type claims it; a zone with no such row claims nothing.
function aggregatesSeenByZone(material, zones) {
  const seenByZone = new Map();
  const taken = new Set();
  for (const zone of zones) {
    const mine = new Set();
    for (const row of auditRowsForZone(material, zone)) {
      const type = row.actionType;
      if (!AGGREGATE.has(type) || taken.has(type)) continue;
      taken.add(type);
      mine.add(type);
    }
    seenByZone.set(zone.id, new Set([...AGGREGATE].filter((type) => !mine.has(type))));
  }
  return seenByZone;
}

// The user message for one zone. `aggregatesSeen` is the once-a-turn lines another zone has already claimed (see above), so "hunger was charged" lands in one zone's input rather than all six.
function zoneBlock(material, zone, { aggregatesSeen, memory = [] }) {
  const here = material.characters.filter((c) => resolveSeat(c.zoneId, material.seatByZoneId) === zone.id);
  const hereIds = new Set(here.map((c) => c.id));

  const roster = here.map((character) => {
    const bits = [displayName(character)];
    if (character.role?.name) bits.push(character.role.name);
    if (character.faction?.name) bits.push(character.faction.name);
    if (character.location?.name) bits.push(character.location.name);
    const live = liveTagNames(character);
    if (live.length) bits.push(live.join(", "));
    return `- ${bits.join(" · ")}`;
  });

  const moves = material.actions
    .filter(
      (action) =>
        hereIds.has(action.characterId) || resolveSeat(action.zoneId, material.seatByZoneId) === zone.id,
    )
    .map((action) => moveLine(action, material.names.byCharacterId.get(action.characterId) ?? "somebody"));

  const auditLines = auditLinesFor(auditRowsForZone(material, zone), material.names, aggregatesSeen);

  const beats = material.beats
    .filter((b) => resolveSeat(b.zoneId, material.seatByZoneId) === zone.id)
    .map((b) => `${b.kind} | ${b.content}`);

  // A GM's own turn narration and its mechanical effects. A PUBLIC message lands by its own zoneId; a PRIVATE one (a DM with no room trace) lands by wherever its recipient(s) are NOW, the same live-position approximation auditRowsForZone makes. One line per message even with several recipients.
  const staged = [
    ...(material.stagedMessages ?? [])
      .filter(
        (m) =>
          resolveSeat(m.zoneId, material.seatByZoneId) === zone.id ||
          (m.recipients ?? []).some((r) => resolveSeat(r.character?.zoneId, material.seatByZoneId) === zone.id),
      )
      .map((m) => `${m.kind} | ${m.content}`),
    ...(material.stagedEffects ?? [])
      .filter((e) => resolveSeat(e.targetCharacter?.zoneId, material.seatByZoneId) === zone.id)
      .map((e) => [e.targetCharacter?.name ?? "somebody", describeStagedEffect(e.appliedEffect)])
      .filter(([, line]) => line)
      .map(([name, line]) => `${name}: ${line}`),
  ];

  const chat = material.chat
    .filter((m) => resolveSeat(m.zoneId, material.seatByZoneId) === zone.id)
    .map((m) => `${m.concealedAlias ?? m.characterName ?? "someone"}: ${m.content}`);

  const sections = [
    `ZONE: ${zone.name}`,
    memory.length ? `PREVIOUS TURNS\n${memory.join("\n\n")}` : null,
    roster.length ? `PRESENT (${roster.length})\n${roster.join("\n")}` : "PRESENT\nNobody.",
    moves.length ? `MOVES\n${moves.join("\n")}` : null,
    auditLines.length ? `EVENTS\n${auditLines.join("\n")}` : null,
    staged.length ? `STAGED\n${staged.join("\n")}` : null,
    beats.length ? `NOTABLE\n${beats.join("\n")}` : null,
    chat.length ? `CHAT\n${chat.join("\n")}` : null,
  ].filter(Boolean);

  return {
    text: sections.join("\n\n"),
    counts: { present: roster.length, moves: moves.length, events: auditLines.length + beats.length + staged.length },
  };
}

// Lifecycle actionTypes describing the GM's OWN bookkeeping about a threat seat (offering a spawn, pinning an objective), rather than a seat-holder's fiction. auditRowsForZone never surfaces these (no locationId), so pulling them here by actionType alone is safe.
const THREAT_LIFECYCLE_TYPES = new Set([
  "threat_assigned",
  "threat_spawn_offered",
  "threat_spawn_cancelled",
  "objective_added",
  "objective_pinned",
  "objective_removed",
  "rite_fired",
]);

const SPAWN_VERB = { PENDING: "offered", ACCEPTED: "accepted", DECLINED: "declined", CANCELLED: "cancelled" };

// The Threats correspondent's page. Shaped like a zone's (PRESENT, MOVES, EVENTS, STAGED) since it's read into the front page's zone list the same way (ORACLE.md), scoped to seat-holders instead of a place. No real Zone row, so `resolveSeat` never enters — membership comes from `db/lib/objectives.js#membersByParty`.
function threatsBlock(material, { aggregatesSeen, memory = [] }) {
  const seatById = new Map();
  for (const [partyKey, members] of material.threatMembers ?? []) {
    for (const m of members) seatById.set(m.id, { ...m, partyKey });
  }
  const here = material.characters.filter((c) => seatById.has(c.id));
  const hereIds = new Set(here.map((c) => c.id));
  const hereNames = new Set(here.map((c) => c.name));

  const roster = here.map((character) => {
    const seat = seatById.get(character.id);
    const bits = [displayName(character), seat?.seat ?? "Threat"];
    if (character.location?.name) bits.push(character.location.name);
    const live = liveTagNames(character);
    if (live.length) bits.push(live.join(", "));
    return `- ${bits.join(" · ")}`;
  });

  const moves = material.actions
    .filter((action) => hereIds.has(action.characterId))
    .map((action) => moveLine(action, material.names.byCharacterId.get(action.characterId) ?? "somebody"));

  // A seat-holder's own actions (the same rows zoneBlock draws on) plus the GM's bookkeeping about the seats — two different questions, both worth this page.
  const ownRows = material.auditRows.filter((row) => {
    const actor = here.find((c) => c.discordUserId === row.actorDiscordUserId);
    return Boolean(actor) || (row.targetCharacterId && hereIds.has(row.targetCharacterId));
  });
  const lifecycleRows = material.auditRows.filter((row) => THREAT_LIFECYCLE_TYPES.has(row.actionType));
  const auditLines = auditLinesFor([...ownRows, ...lifecycleRows], material.names, aggregatesSeen);

  const spawnLines = (material.spawns ?? []).map((s) => {
    const verb = SPAWN_VERB[s.status] ?? s.status;
    return `spawn | ${s.threatSlug} | ${s.role?.name ?? "unknown role"} | ${verb}`;
  });

  const riteLines = (material.rites ?? []).map((r) => `rite | ${r.riteKey} | ${r.roomName} | ${r.status}`);

  // Current score, not a diff — Objective has no completion timestamp to window on, so this is a snapshot every turn, leaning on the model's own three-turn memory to notice a change.
  const objectiveLines = [...(material.objectivesByParty ?? new Map())].flatMap(([partyKey, rows]) =>
    rows.map((row) => {
      const state = row.pinned === true ? "success" : row.pinned === false ? "failed" : "undecided";
      return `objective | ${partyKey} | ${row.description} | ${state}`;
    }),
  );

  const beats = material.beats.filter((b) => hereNames.has(b.characterName)).map((b) => `${b.kind} | ${b.content}`);

  const staged = [
    ...(material.stagedMessages ?? [])
      .filter((m) => (m.recipients ?? []).some((r) => hereIds.has(r.character?.id)))
      .map((m) => `${m.kind} | ${m.content}`),
    ...(material.stagedEffects ?? [])
      .filter((e) => hereIds.has(e.targetCharacterId))
      .map((e) => [e.targetCharacter?.name ?? "somebody", describeStagedEffect(e.appliedEffect)])
      .filter(([, line]) => line)
      .map(([name, line]) => `${name}: ${line}`),
  ];

  const sections = [
    "THREATS",
    memory.length ? `PREVIOUS TURNS\n${memory.join("\n\n")}` : null,
    roster.length ? `PRESENT (${roster.length})\n${roster.join("\n")}` : "PRESENT\nNobody holds a seat.",
    moves.length ? `MOVES\n${moves.join("\n")}` : null,
    auditLines.length ? `EVENTS\n${auditLines.join("\n")}` : null,
    spawnLines.length ? `SPAWNS\n${spawnLines.join("\n")}` : null,
    riteLines.length ? `RITES\n${riteLines.join("\n")}` : null,
    objectiveLines.length ? `OBJECTIVES\n${objectiveLines.join("\n")}` : null,
    staged.length ? `STAGED\n${staged.join("\n")}` : null,
    beats.length ? `NOTABLE\n${beats.join("\n")}` : null,
  ].filter(Boolean);

  return {
    text: sections.join("\n\n"),
    counts: { present: roster.length, moves: moves.length, events: auditLines.length + beats.length + staged.length },
  };
}

// The model writes {char:Ada Vance}. Stored text uses the canonical mention grammar, {char:<id>|<Name>} (db/lib/characterMentions.js), so this rewrites one into the other against the turn's roster before the page is saved.
// Resolving at WRITE time is what makes an invented name harmless: a name nobody answers to loses its braces and becomes ordinary prose, never a live link to the wrong character. The two regexes cannot collide: characterMentions.js's TOKEN_RE matches [A-Za-z0-9_-] only, so a name with a space is invisible to it until this function finishes.
const NAME_TOKEN_RE = /\{char:([^{}|\n]{1,80})\}/g;

function linkCharacterTokens(text, characters) {
  if (!text) return "";

  // Both the bare name and the annotated form the Oracle is told to write, so `{char:Bram Holt}` resolves either way.
  const byName = new Map();
  for (const character of characters) {
    if (character.name) byName.set(character.name.toLowerCase(), character.id);
  }

  return String(text).replace(NAME_TOKEN_RE, (raw, inner) => {
    const name = inner.trim();
    // The roster is asked FIRST, and the order is the whole point: a MONONYM (Adeliz, Grendel, Weasel) looks exactly like a cuid to a shape test, so checking id-shape first would mistake every single-word name for an already-resolved id and hand it back unlinked.
    const id = byName.get(name.toLowerCase());
    if (id) return `{char:${id}|${name}}`;
    // Nobody answers to it: either it's already a canonical id (left as-is), or the model invented a person, and an invented name loses its braces rather than becoming a live link to the wrong character (ORACLE.md §5).
    if (/^[A-Za-z0-9_-]{1,64}$/.test(name)) return raw;
    return name;
  });
}

module.exports = {
  aggregatesSeenByZone,
  windowBetween,
  turnWindow,
  displayName,
  loadTurnMaterial,
  zoneBlock,
  threatsBlock,
  linkCharacterTokens,
  describeStagedEffect,
  resolveSeat,
};
