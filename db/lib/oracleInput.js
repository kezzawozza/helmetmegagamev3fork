// Everything the Oracle reads, turned into one text block per zone.
// See docs/systemdocs/ORACLE.md.
//
// This module is the whole of the Oracle's access to game state, which is
// deliberate: what a correspondent may see is a question with a right answer,
// and it should be answerable by reading one file.
//
// Three things here are easy to get wrong and are each commented where they
// happen: the turn window runs lock to lock and is derived rather than read off
// AuditLog's turnId, tags are filtered to the two categories that actually
// move, and a concealed character is written with both faces rather than one.

const { auditLinesFor, AGGREGATE } = require("./oracleAudit");
const { moveCutoffAt } = require("./turnClock");
const {
  CONCEALMENT_TAG_FIELDS,
  forcedNameFrom,
  concealmentFrom,
  presentedIdentity,
} = require("./presentedIdentity");
const { PARTIES } = require("./threats");
const { listObjectives, membersByParty } = require("./objectives");

// The only two tag categories worth re-reading every turn. A character's
// Beliefs and Skills are bought at creation and never move, so shipping all
// 699 tags' worth of catalog every turn would pay repeatedly for a constant —
// and crowd out the moves, which are the part that changes.
//
// Health and status are the two that DO move: injuries, the mood band, Tipsy,
// Ate Meal. Everything else reaches the Oracle as a CHANGE, through the audit
// lines, rather than as a standing fact.
const LIVE_TAG_CATEGORIES = ["health", "status"];

// ArchiveEntry kinds that are events rather than speech. These are already
// turn-stamped, which AuditLog rows are not.
const BEAT_KINDS = ["DEATH", "CHARACTER_CREATED", "DESIRE_FULFILLED", "LIFEWEB", "TRAVEL"];

// The turn's wall-clock window, LOCK TO LOCK.
//
// It has to be derived, because AuditLog.turnId is NULL on most rows: the
// column exists for the per-turn rations and is not a general "which turn was
// this" stamp. /gm/audit derives the same way. Filtering audit rows on turnId
// would silently return almost nothing, which reads as a quiet turn rather than
// as the bug it is.
//
// Cutoff to cutoff rather than start to end, because that is when the Oracle
// now runs. Turn N's page is written at N's Move cutoff, so it can only see as
// far as that; the three hours after it — the late chat, the GM's own
// adjudications, and everything the midnight push fires — belong to N+1's page,
// which is the first one written after they happened. Windowing on startedAt
// instead would ask each page for three hours that did not exist yet when it
// was drafted, and no page would ever carry them.
//
// The floor is the last turn that was actually CHRONICLED, not simply the last
// turn. Those differ, and using the wrong one loses days.
//
// A turn with a frozen clock or one shorter than the lock gets no page at all,
// and moveCutoffAt() cannot tell you that: it is a pure function of startedAt
// and hands back a 21:00 for every turn that has one, lock or no lock. Anchor
// on the previous turn and a frozen Tuesday reads as covered when nothing ever
// covered it. Anchor on the last turn that has a page and the frozen days fall
// inside the next real page's window, which is where they belong.
//
// The clamp is the other half. A turn a GM opens at 23:00 ends at midnight, so
// its derived cutoff is 21:00 — two hours BEFORE it began. Left alone that
// pulls the floor backwards and two pages chronicle the same evening twice.
//
// Pure, so all of that is testable without a database.
function windowBetween(anchorTurn, turn) {
  const to = moveCutoffAt(turn) ?? new Date();
  if (!anchorTurn) return { from: turn.startedAt, to };
  const cutoff = moveCutoffAt(anchorTurn);
  const startedAt = new Date(anchorTurn.startedAt);
  const from = cutoff && cutoff > startedAt ? cutoff : startedAt;
  return { from, to };
}

async function turnWindow(prisma, turn) {
  // The newest earlier turn that has a page. Falls through to the newest
  // earlier turn of any kind when the Oracle has never run — enabling it
  // mid-game should not make its first page a chronicle of the entire game.
  const anchor =
    (await prisma.turn.findFirst({
      where: { number: { lt: turn.number }, oraclePages: { some: {} } },
      orderBy: { number: "desc" },
      select: { number: true, startedAt: true },
    })) ??
    (await prisma.turn.findFirst({
      where: { number: { lt: turn.number } },
      orderBy: { number: "desc" },
      select: { number: true, startedAt: true },
    }));
  return windowBetween(anchor, turn);
}

// How the Oracle refers to somebody.
//
// ORACLE.md: real names, with the mask annotated. A GM reading this needs to
// know both that it was Bram and that the room did not know that — writing only
// the true name hides that a disguise was in play, and writing only the alias
// makes a character impossible to follow across turns.
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

// One Move as one line. diceRoll and diceModifier are kept apart in the schema
// on purpose — a GM must be able to tell a natural 5 from a modified one — so
// they are reported apart here too rather than silently summed.
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

// A StagedEffect's `appliedEffect` snapshot into one line, same posture as
// db/lib/moveEffects.js#describeMoveEffects: short and deterministic rather
// than prose, and silently skipping a key it doesn't recognise rather than
// throwing — a shape this file hasn't been taught yet should read as nothing
// worth reporting, not as a crash.
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

// Load once, slice per zone. Six queries for the whole turn rather than six per
// zone: the correspondents run in parallel and would otherwise stampede the
// pool at exactly the moment turn rollover is already contending for it.
// zoneId -> its seat zone's id, for every zone — not just the six seats.
// Presence is finer than the seats a GM/correspondent is scoped to
// (`db/lib/seatZone.js`): the two cave levels, `caves` and `depths`, are
// CHILD zones of the seat `underground`, so `Character.zoneId` (and every
// other zoneId this file reads) can legitimately read `caves` for a
// character standing exactly where the Underground correspondent is meant to
// see them.
//
// `seatZone.js`'s own comment claims every writer already stamps the seat id
// on Action/StagedMessage rows, but the live data disagrees — most Action
// rows carry the raw presence zoneId, only `db/lib/locationTravel.js:544`
// actually calls `seatZoneIdFor`. So this file resolves defensively rather
// than trust that invariant: every zoneId comparison below goes through this
// map first. A future query that compares a raw `zoneId === zone.id` without
// it will quietly lose the cave levels the same way this bug did.
async function loadSeatByZoneId(prisma) {
  const zones = await prisma.zone.findMany({ select: { id: true, seatZoneId: true } });
  return new Map(zones.map((z) => [z.id, z.seatZoneId ?? z.id]));
}

// `seatByZoneId` is optional so this stays safe against a caller/fixture that
// predates it and never built one; a map really is expected once `material`
// comes from `loadTurnMaterial`.
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
          // slug is `membersByParty`'s own admission ticket (db/lib/objectives.js)
          // — it's how a character is recognised as sitting a threat seat at
          // all, for the Threats correspondent below.
          tag: { select: { ...CONCEALMENT_TAG_FIELDS, category: true, slug: true } },
        },
      },
    },
  });

  // Who sits a threat seat right now, and which party they answer for — the
  // same helper the end-of-game reveal uses (db/lib/objectives.js), so the
  // Threats page can never disagree with `/gm/dev?s=antagonists` about who is
  // seated. Objectives are read only for a party that actually has someone
  // seated: an unseated party "never existed in play" (buildAntagonistReveal's
  // own rule) and printing its prep here would be the same thing this file
  // exists to avoid — showing a GM game state nobody is currently acting on.
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
    // Moves go by the WINDOW too, not by turnId, and for a reason that only
    // shows up once the run moved to the cutoff: the auto-labor pass files a
    // Move for everybody who filed none, and it does that at the PUSH — three
    // hours after this turn's page is written (db/lib/autoLaborPass.js, a
    // TURN_PASS). Stamped turnId N, created after N's page exists. On the FK
    // they would appear in no page ever, and in a hundred-player game they are
    // most of the Moves there are. The window catches them in N+1, beside the
    // audit lines that say what they paid.
    //
    // A player's own Move is unaffected: it can only be filed before the lock,
    // so it lands in its own turn's window either way.
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
    // Beats and chat go by the WINDOW, not by turnNumber, and the difference
    // matters now that the run happens at the cutoff. An entry stamped
    // turnNumber N but sent after N's lock does not exist yet when N's page is
    // written, and a page keyed on turnNumber N+1 would never look for it —
    // so the last three hours of every day would fall out of the record
    // entirely. The window is the authority; the stamp is not.
    //
    // sentAt rather than createdAt: the table carries both, and every index is
    // on sentAt. createdAt has none, so filtering on it would put a sequential
    // scan of the whole transcript on this path once a turn.
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
    // A GM's own turn narration — the tray a GM fills during adjudication,
    // ADJUDICATION.md §1 — SENT by the window's push, same reasoning as the
    // Move comment above: a message staged during N's three-hour window and
    // sent at N's push is created after N's page exists, so it belongs to
    // N+1's window and this is where it is caught. Read by sentAt, the same
    // column stagedPush.js stamps once delivery is actually attempted, so a
    // row still sitting in the tray (nothing pushed yet) is correctly
    // invisible — the Oracle reports what happened, not what a GM is drafting.
    //
    // PUBLIC and PRIVATE are both read: a PRIVATE row went out as a DM, never
    // through the room's own channel, so it never became a chat line or an
    // ArchiveEntry at all — the Oracle had no other way to learn a landmine
    // took someone's leg off if the only trace of it was a DM. This is a GM
    // tool query, not a player-facing feed, so the privacy argument that keeps
    // a PRIVATE staged message off chat and the archive does not apply here.
    prisma.stagedMessage.findMany({
      where: { sentAt: { gte: window.from, lt: window.to } },
      select: {
        kind: true,
        content: true,
        zoneId: true,
        recipients: { select: { character: { select: { id: true, zoneId: true } } } },
      },
    }),
    // The mechanical half of the same tray — a resource burn, a tag grant,
    // a staged relocation (StagedEffect, ADJUDICATION.md §1). `appliedAt` is
    // this row's own delivery stamp, so the window logic is identical to the
    // narration query above. `targetCharacterId` is nullable only for a
    // Room -> Room transfer (schema comment on the column), which has no zone
    // of its own to land in and is dropped by describeStagedEffect below
    // finding no character to place it against.
    prisma.stagedEffect.findMany({
      where: { appliedAt: { gte: window.from, lt: window.to } },
      select: {
        targetCharacterId: true,
        appliedEffect: true,
        targetCharacter: { select: { zoneId: true, name: true } },
      },
    }),
    // The one lifecycle table with no audit row of its own (db/lib/threatSpawn.js
    // stamps status/resolvedAt and nothing else) — createdAt catches an offer
    // made this window, resolvedAt catches one accepted, declined or cancelled
    // in it. A spawn can appear twice across two windows (offered in one,
    // resolved in the next) which is correct: each half is its own event.
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

// The audit rows one zone's page is built from.
//
// An audit row carries no zone, so it is placed by its ACTOR's current
// position. That is approximate — somebody can act in Town and walk to the
// Fortress before the turn closes — and it is the right approximation: the
// alternative is a row appearing in no zone's input at all.
function auditRowsForZone(material, zone) {
  const here = material.characters.filter((c) => resolveSeat(c.zoneId, material.seatByZoneId) === zone.id);
  const hereIds = new Set(here.map((c) => c.id));
  return material.auditRows.filter((row) => {
    const actor = here.find((c) => c.discordUserId === row.actorDiscordUserId);
    return Boolean(actor) || (row.targetCharacterId && hereIds.has(row.targetCharacterId));
  });
}

// Which once-a-turn lines each zone must NOT report — the map runOracle hands
// to the six calls, one Set each.
//
// "Hunger was charged" is true of the whole game, not of a zone, so exactly one
// page says it. That used to be a single mutable Set threaded through six calls
// made in order, which only works while the calls ARE in order; the six run at
// once now, so the claim is settled here first, before any of them start.
//
// Same answer as the sequential version gave: zones are walked in the order
// runOracle has them, and the first one holding a row of that type claims it.
// A zone with no such row claims nothing, so a line never lands on a page whose
// own rows never mentioned it.
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

// The user message for one zone. `aggregatesSeen` is the once-a-turn lines some
// other zone has already claimed (see above), so "hunger was charged" lands in
// one zone's input rather than all six.
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

  // A GM's own turn narration and its mechanical effects (StagedMessage/
  // StagedEffect, loaded in the window above). A PUBLIC message lands by its
  // own zoneId; a PRIVATE one — a DM with no room trace at all — lands by
  // wherever its recipient(s) are NOW, the same live-position approximation
  // auditRowsForZone above already makes for an audit row with no zone of its
  // own. One line per message even with several recipients here, since it is
  // one thing that was said, not one per reader.
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

// Lifecycle actionTypes that describe the GM's OWN bookkeeping about a threat
// seat, rather than something a seat-holder did in the fiction — a GM offering
// a spawn, pinning an objective. auditRowsForZone would never surface these
// anyway (none carries a locationId), so pulling them here by actionType alone
// is safe: they cannot double up on a zone page.
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

// The Threats correspondent's page. Shaped exactly like a zone's — PRESENT,
// MOVES, EVENTS, STAGED — because it is read into the front page's zone list
// the same way (ORACLE.md), just scoped to seat-holders instead of a place.
// There is no real Zone row behind it, so `resolveSeat` never enters here:
// membership comes from `db/lib/objectives.js#membersByParty`, the same
// helper the end-of-game reveal uses, so this page can never disagree with
// /gm/dev?s=antagonists about who is seated.
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

  // A seat-holder's own actions (from the general audit log, the same rows
  // zoneBlock draws on) plus the GM's bookkeeping about the seats themselves —
  // two different questions, both worth this page.
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

  // Current score, not a diff — Objective has no completion timestamp to
  // window on (schema comment on the model), so this reads as a snapshot every
  // turn and leans on the model's own three-turn memory to notice a change,
  // the same way a zone correspondent notices somebody circling the gatehouse.
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

// The model writes {char:Ada Vance}. Stored text uses the canonical mention
// grammar, {char:<id>|<Name>} (db/lib/characterMentions.js), so this rewrites
// one into the other against the turn's roster before the page is saved.
//
// Resolving at WRITE time rather than at render time is what makes an invented
// name harmless: a name no character answers to loses its braces and becomes
// ordinary prose. A model that hallucinates a person therefore produces a
// sentence about a stranger, never a live link to one — and never a link to the
// WRONG one, which is what matching loosely at render time would eventually do.
//
// Note the two regexes cannot collide: characterMentions.js's TOKEN_RE matches
// [A-Za-z0-9_-] only, so a name with a space in it is invisible to the existing
// mention machinery right up until this function has finished with it.
const NAME_TOKEN_RE = /\{char:([^{}|\n]{1,80})\}/g;

function linkCharacterTokens(text, characters) {
  if (!text) return "";

  // Both the bare name and the annotated form the Oracle is told to write, so
  // `{char:Bram Holt}` resolves whether or not the model appended the mask.
  const byName = new Map();
  for (const character of characters) {
    if (character.name) byName.set(character.name.toLowerCase(), character.id);
  }

  return String(text).replace(NAME_TOKEN_RE, (raw, inner) => {
    const name = inner.trim();
    // The roster is asked FIRST, and the order is the whole point. A MONONYM —
    // Adeliz, Grendel, Weasel — is a real character name that also looks
    // exactly like a cuid to a shape test: letters, no spaces. Checking the
    // id-shape first therefore mistook every single-word name for an id
    // already resolved and handed it back untouched, so `{char:Adeliz}` was
    // stored as a token pointing at nobody, and the one name in the sentence a
    // GM most wants to click was the one that could never be clicked.
    const id = byName.get(name.toLowerCase());
    if (id) return `{char:${id}|${name}}`;
    // Nobody answers to it. Either it is already a canonical id, which is left
    // exactly as it is, or the model invented a person — and an invented name
    // loses its braces and becomes ordinary prose rather than a live link to
    // the wrong character (ORACLE.md §5).
    if (/^[A-Za-z0-9_-]{1,64}$/.test(name)) return raw;
    return name;
  });
}

module.exports = {
  LIVE_TAG_CATEGORIES,
  BEAT_KINDS,
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
