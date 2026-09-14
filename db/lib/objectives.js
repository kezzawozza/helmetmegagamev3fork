// Antagonist objectives: scoring them, listing them, and the end-of-game
// reveal (docs/systemdocs/THREATS.md §6a). Catalog of kinds:
// db/lib/objectiveKinds.js; rows are the Objective table.
// THREE CHECKERS decide a scripted kind, all read on demand rather than in a
// turn pass. The GM's PIN wins over any checker; scripted kinds start
// unpinned, manual kinds are never unpinned since the pin is their only answer.
// Takes `prisma` as a parameter (the db/lib/dm.js convention) and stays off
// the @lifeweb/db barrel.

const { turnDay } = require("./turnFormat");
const { objectiveKind, describeObjective } = require("./objectiveKinds");
const { threatBySeatTag, partyOf, PARTIES } = require("./threats");
const { hasAttribute, WILDERNESS_ATTRIBUTE } = require("./locationAttributes");

// Can this Location be the target of "Blow up [Location]"? Above ground and
// not wilderness. Needs the row's `attributes` and `zone.kind`.
function locationEligible(location) {
  return location?.zone?.kind === "SURFACE" && !hasAttribute(location, WILDERNESS_ATTRIBUTE);
}

async function loadDeaths(prisma, gameId) {
  return prisma.archiveEntry.findMany({
    where: { kind: "DEATH", ...(gameId ? { gameId } : {}) },
    select: { characterId: true, turnNumber: true },
  });
}

// The most deaths any one in-game day saw. Two turns make a day
// (db/lib/turnFormat.js#turnDay); a row with no turn number belongs to no
// day. The bomb's turn is left out entirely: the blast is the Tribunal's
// objective, not a Thanati bloodbath.
function maxDeathsInOneDay(deaths, { excludeTurn = null } = {}) {
  const perDay = new Map();
  for (const d of deaths) {
    if (d.turnNumber == null || d.turnNumber === excludeTurn) continue;
    const day = turnDay({ number: d.turnNumber });
    perDay.set(day, (perDay.get(day) ?? 0) + 1);
  }
  let max = 0;
  for (const n of perDay.values()) if (n > max) max = n;
  return max;
}

// Every row's answer, batched: one character read for every target, one
// state read, one death read, each only if some row needs it and the caller
// didn't hand it over. Returns Map<id, { done, source }>.
async function evaluateObjectives(prisma, rows, { state = null, deaths = null } = {}) {
  const results = new Map();
  const targetIds = new Set();
  let needState = false;
  let needDeaths = false;

  for (const row of rows) {
    if (row.pinned != null) continue;
    const kind = objectiveKind(row.kind);
    if (kind?.script === "characterDead" && row.targetCharacterId) targetIds.add(row.targetCharacterId);
    if (kind?.script === "nukeDetonated") needState = true;
    if (kind?.script === "deathsInOneDay") needDeaths = true;
  }

  // Counting deaths needs the state too: gameId scopes the rows and nukeDetonatedTurn is left out of the count.
  const mustLoadState = (needState || needDeaths) && !state;
  const [targets, loadedState] = await Promise.all([
    targetIds.size
      ? prisma.character.findMany({ where: { id: { in: [...targetIds] } }, select: { id: true, status: true } })
      : [],
    mustLoadState
      ? prisma.gameState.findUnique({
          where: { id: 1 },
          include: { game: { select: { nukeDetonatedTurn: true } } },
        })
      : state,
  ]);
  const gameId = loadedState?.gameId ?? null;
  // Off the Game row, not GameState (db/lib/turnBanner.js) — the GameState copy belongs to no game in particular.
  const nukeTurn = loadedState?.game?.nukeDetonatedTurn ?? null;
  const loadedDeaths = needDeaths && !deaths ? await loadDeaths(prisma, gameId) : deaths;

  const statusOf = new Map(targets.map((t) => [t.id, t.status]));
  const worstDay = needDeaths
    ? maxDeathsInOneDay(loadedDeaths ?? [], { excludeTurn: nukeTurn })
    : 0;

  for (const row of rows) {
    if (row.pinned != null) {
      results.set(row.id, { done: row.pinned, source: "pinned" });
      continue;
    }
    const kind = objectiveKind(row.kind);
    let done = false;
    switch (kind?.script) {
      // DEAD exactly (CHARACTERS.md); a Revive un-scores this until pinned.
      case "characterDead":
        done = statusOf.get(row.targetCharacterId) === "DEAD";
        break;
      case "deathsInOneDay":
        done = row.value != null && worstDay >= row.value;
        break;
      case "nukeDetonated":
        done = nukeTurn != null;
        break;
      default:
        // A manual kind with no pin — the actions refuse it — reads as not done, not a throw.
        done = false;
    }
    results.set(row.id, { done, source: "script" });
  }
  return results;
}

// The rows, described and scored, oldest first — called for one party by the
// objective-reveal rite, for all by /gm/dev.
async function listObjectives(prisma, { partyKey = null, state = null, deaths = null } = {}) {
  const rows = await prisma.objective.findMany({
    where: partyKey ? { partyKey } : {},
    orderBy: { createdAt: "asc" },
  });
  const scored = await evaluateObjectives(prisma, rows, { state, deaths });
  return rows.map((row) => {
    const kind = objectiveKind(row.kind);
    const result = scored.get(row.id) ?? { done: false, source: "script" };
    return {
      ...row,
      description: describeObjective(row),
      done: result.done,
      source: result.source,
      scripted: Boolean(kind?.script),
      placeholder: Boolean(kind?.placeholder),
    };
  });
}

// Which seat a character answers for within a party, when holding more than
// one of its tags — the seat whose grant includes the others' tags names them.
function primarySeat(seats) {
  return (
    seats.find((s) => seats.every((o) => o === s || (s.assign?.tagSlugs ?? []).includes(o.seatTagSlug))) ??
    seats[0]
  );
}

// Who sits in each party: Map<partyKey, [{ id, name, seat }]>, leader first.
// `characters` are rows with `id`, `name`, seat tags as `tags: [{ tag: {
// slug } }]` — what both buildEpilogue and /gm/dev supply.
function membersByParty(characters) {
  const members = new Map();
  for (const c of characters) {
    const held = (c.tags ?? []).map((t) => threatBySeatTag(t.tag?.slug ?? t.slug)).filter(Boolean);
    if (held.length === 0) continue;
    const byParty = new Map();
    for (const seat of held) {
      const key = partyOf(seat).key;
      if (!byParty.has(key)) byParty.set(key, []);
      byParty.get(key).push(seat);
    }
    for (const [key, seats] of byParty) {
      const seat = primarySeat(seats);
      if (!members.has(key)) members.set(key, []);
        // leads: this seat's grant includes another party seat's tag.
      members.get(key).push({ id: c.id, name: c.name, seat: seat.name, leads: seats.length > 1 });
    }
  }
  for (const list of members.values()) {
    list.sort((a, b) => (a.leads === b.leads ? 0 : a.leads ? -1 : 1));
    for (const m of list) delete m.leads;
  }
  return members;
}

// The reveal: every party somebody actually sat in, its members and scored
// objectives. A party with objectives and no member is left out — printing
// its prep would only confuse the room.
async function buildAntagonistReveal(prisma, { characters, deaths = null, state = null }) {
  const members = membersByParty(characters);
  if (members.size === 0) return [];

  const objectives = await listObjectives(prisma, { state, deaths });
  const reveal = [];
  for (const party of PARTIES) {
    const list = members.get(party.key);
    if (!list?.length) continue;
    reveal.push({
      partyKey: party.key,
      partyName: party.name,
      solo: party.solo,
      members: list.map(({ name, seat }) => ({ name, seat })),
      objectives: objectives.filter((o) => o.partyKey === party.key).map((o) => ({ text: o.description, done: o.done })),
    });
  }
  return reveal;
}

// Bascinet's format, one line per party:
//   Ash was a Judge.
//   Ash (Thanati Leader), Wren, Lark were the Thanati. Their objectives were:
//   Kill Corvin. **Success!** / Deface the icon. **Failed!**
// Seat name appended only when it differs from the party's.
function formatAntagonistLines(reveal) {
  return (reveal ?? []).map((party) => {
    const names = party.members.map((m) => (m.seat !== party.partyName ? `${m.name} (${m.seat})` : m.name));
    const head =
      party.solo && names.length === 1
        ? `${names[0]} was a ${party.partyName}.`
        : `${names.join(", ")} were the ${party.partyName}.`;
    if (party.objectives.length === 0) return head;
    const list = party.objectives
      .map((o) => {
        const text = o.text.trim();
        const stopped = /[.!?…]$/.test(text) ? text : `${text}.`;
        return `${stopped} ${o.done ? "**Success!**" : "**Failed!**"}`;
      })
      .join(" / ");
    return `${head} Their objectives were: ${list}`;
  });
}

// A rite pinning its own objective (THANATI.md §4): every row of the party
// for these kinds naming this character goes to Success. A GM can still pin it back.
async function fulfillObjectives(db, { partyKey, kinds, targetCharacterId }) {
  if (!partyKey || !kinds?.length || !targetCharacterId) return 0;
  const { count } = await db.objective.updateMany({
    where: { partyKey, kind: { in: kinds }, targetCharacterId },
    data: { pinned: true },
  });
  return count;
}

module.exports = {
  fulfillObjectives,
  locationEligible,
  evaluateObjectives,
  listObjectives,
  membersByParty,
  buildAntagonistReveal,
  formatAntagonistLines,
  maxDeathsInOneDay,
};
