import { prisma } from "@lifeweb/db";
import { DATE_PRESETS, auditFamily, familyPrefixes, knownTypesInFamily, familiesInBand } from "@/lib/auditNarrative";
import { parseQuery } from "@/lib/fuzzySearch";

// The audit log's filter parser and WHERE builder, shared by the page and export so a CSV can never disagree.
// Filtering is SERVER-side (unlike DataTable.js), and the whole filter state lives in the URL so a view survives being a link.

export const PAGE_SIZE = 60;

// Repeatable params arrive from URLSearchParams as a string or an array; normalize once at the door.
function list(raw) {
  if (raw == null) return [];
  const values = Array.isArray(raw) ? raw : [raw];
  return [...new Set(values.flatMap((v) => String(v).split(",")).map((v) => v.trim()).filter(Boolean))];
}

function one(raw) {
  return raw == null ? "" : String(Array.isArray(raw) ? raw[0] : raw).trim();
}

// A `YYYY-MM-DD` query param as a real Date, or null on anything unparseable (a thrown Prisma error is not).
function parseDateParam(raw, timeSuffix) {
  const text = one(raw);
  if (!text) return null;
  const parsed = new Date(`${text}${timeSuffix}`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// Reads searchParams into the one shape everything downstream uses; pure, so the page can echo it back.
export function parseAuditParams(params) {
  return {
    q: one(params?.q),
    families: list(params?.family),
    // Which half of the log to read. Empty defaults to player; "all" opts into machine lines too.
    band: ["player", "machine", "all"].includes(one(params?.band)) ? one(params.band) : "",
    types: list(params?.type),
    actors: list(params?.actor),
    actorKind: one(params?.actorKind),
    targets: list(params?.target),
    zones: list(params?.zone),
    // WHERE it happened — AuditLog.locationId/roomId, forward-only. Distinct from `zones` above, which is the zone the target is standing in.
    locations: list(params?.location),
    rooms: list(params?.room),
    turnFrom: one(params?.turnFrom),
    turnTo: one(params?.turnTo),
    preset: DATE_PRESETS[one(params?.preset)] ? one(params.preset) : "",
    from: parseDateParam(params?.from, "T00:00:00"),
    to: parseDateParam(params?.to, "T23:59:59"),
    page: Math.max(1, Number.parseInt(one(params?.page) || "1", 10) || 1),
  };
}

// Everything the WHERE needs that isn't in the URL: GM ids, character->zone/role, turn boundaries, guild handles.
export async function loadAuditContext({ gmIds, guildMembers }) {
  const [characters, turns] = await Promise.all([
    prisma.character.findMany({
      select: {
        id: true,
        name: true,
        status: true,
        discordUserId: true,
        roleTitle: true,
        zone: { select: { id: true, name: true } },
      },
    }),
    // Ascending: bucketing a timestamp into a turn is a walk forward through the boundaries.
    prisma.turn.findMany({ select: { number: true, dayNumber: true, startedAt: true }, orderBy: { startedAt: "asc" } }),
  ]);
  return { characters, turns, gmIds: new Set(gmIds ?? []), guildMembers: guildMembers ?? [] };
}

// Which turn a timestamp fell in — the last turn started by then. AuditLog carries no turnId, so this derives it for the whole history.
export function turnAt(turns, when) {
  let found = null;
  for (const turn of turns) {
    if (turn.startedAt <= when) found = turn;
    else break;
  }
  return found;
}

function turnWindow(turns, fromNumber, toNumber) {
  const from = fromNumber ? turns.find((t) => t.number === Number(fromNumber)) : null;
  // The window ENDS where the turn after `to` began — a turn's rows run until the next one opens.
  const after = toNumber ? turns.find((t) => t.number === Number(toNumber) + 1) : null;
  return { gte: from?.startedAt ?? null, lt: after?.startedAt ?? null };
}

function presetWindow(preset, turns) {
  const now = new Date();
  switch (preset) {
    case "today": {
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      return { gte: start, lt: null };
    }
    case "24h":
      return { gte: new Date(now.getTime() - 24 * 3600_000), lt: null };
    case "7d":
      return { gte: new Date(now.getTime() - 7 * 24 * 3600_000), lt: null };
    case "turn": {
      const current = turns.at(-1);
      return { gte: current?.startedAt ?? null, lt: null };
    }
    default:
      return { gte: null, lt: null };
  }
}

// A family clause matches its KNOWN types plus anything carrying one of its prefixes, so a new action
// type lands in the right family without a change to auditNarrative.js.
function familyClause(family) {
  const known = knownTypesInFamily(family);
  const prefixes = familyPrefixes(family);
  const branches = [
    ...(known.length ? [{ actionType: { in: known } }] : []),
    ...prefixes.map((p) => ({ actionType: { startsWith: p } })),
  ];
  // Defensive rather than reachable: only Lifeweb (all overrides) would hit the fallback.
  return branches.length ? { OR: branches } : { actionType: { in: [] } };
}

// Ids whose `details` blob mentions the search text (Prisma can't LIKE a Json column). LIMIT is the honest cost of an unindexable ILIKE.
const DETAILS_SEARCH_LIMIT = 5000;

async function detailsMatchIds(q) {
  const rows = await prisma.$queryRaw`
    SELECT "id" FROM "AuditLog"
    WHERE "details"::text ILIKE ${`%${q}%`}
    ORDER BY "createdAt" DESC
    LIMIT ${DETAILS_SEARCH_LIMIT}
  `;
  return rows.map((r) => r.id);
}

// Discord handles a term matches — a username lives in Discord, not in any table.
function matchGuildMemberIds(guildMembers, term) {
  const lower = term.toLowerCase();
  return guildMembers
    .filter((m) => m.username?.toLowerCase().includes(lower) || m.globalName?.toLowerCase().includes(lower))
    .map((m) => m.id);
}

// Characters whose `getter` field contains `term`, split into actor (Discord id) and target (character id) branches.
function matchCharacterIds(characters, term, getter) {
  const lower = term.toLowerCase();
  const matched = characters.filter((c) => (getter(c) ?? "").toLowerCase().includes(lower));
  return { actorIds: matched.map((c) => c.discordUserId), targetIds: matched.map((c) => c.id) };
}

const SCOPED_FIELD_GETTERS = {
  role: (c) => c.roleTitle,
  zone: (c) => c.zone?.name,
};

// One word of a parsed query (fuzzySearch.js#parseQuery) into a Prisma OR clause; a scoped word narrows to
// that branch, an empty match resolving to "no rows" via a real { in: [] }.
async function wordWhere(word, ctx) {
  const term = word.term;
  if (!term) return null;

  if (word.field === "username") {
    return { actorDiscordUserId: { in: matchGuildMemberIds(ctx.guildMembers, term) } };
  }
  if (SCOPED_FIELD_GETTERS[word.field]) {
    const { actorIds, targetIds } = matchCharacterIds(ctx.characters, term, SCOPED_FIELD_GETTERS[word.field]);
    return { OR: [{ actorDiscordUserId: { in: actorIds } }, { targetCharacterId: { in: targetIds } }] };
  }

  const lower = term.toLowerCase();
  const matchedActorIds = ctx.characters.filter((c) => c.name.toLowerCase().includes(lower)).map((c) => c.discordUserId);
  const usernameIds = matchGuildMemberIds(ctx.guildMembers, term);
  const detailIds = await detailsMatchIds(term);
  return {
    OR: [
      { actionType: { contains: term, mode: "insensitive" } },
      { actorDiscordUserId: { contains: term, mode: "insensitive" } },
      { reason: { contains: term, mode: "insensitive" } },
      { targetCharacter: { name: { contains: term, mode: "insensitive" } } },
      ...(matchedActorIds.length ? [{ actorDiscordUserId: { in: matchedActorIds } }] : []),
      ...(usernameIds.length ? [{ actorDiscordUserId: { in: usernameIds } }] : []),
      ...(detailIds.length ? [{ id: { in: detailIds } }] : []),
    ],
  };
}

// Builds the Prisma WHERE. Async only because of the details-text branch above.
export async function buildAuditWhere(filters, ctx) {
  const and = [];

  if (filters.families.length) {
    and.push({ OR: filters.families.map(familyClause) });
  } else if (filters.band !== "all") {
    // The default view — without this the turn engine's per-character rows bury what a person actually did.
    const band = filters.band || "player";
    and.push({ OR: familiesInBand(band).map(familyClause) });
  }
  if (filters.types.length) {
    and.push({ actionType: { in: filters.types } });
  }
  if (filters.actors.length) {
    and.push({ actorDiscordUserId: { in: filters.actors } });
  }

  // "system" is a literal actorDiscordUserId the turn engine writes; Player means "neither a GM nor the engine".
  if (filters.actorKind === "gm") {
    and.push({ actorDiscordUserId: { in: [...ctx.gmIds] } });
  } else if (filters.actorKind === "system") {
    and.push({ actorDiscordUserId: "system" });
  } else if (filters.actorKind === "player") {
    and.push({ actorDiscordUserId: { notIn: [...ctx.gmIds, "system"] } });
  }

  if (filters.targets.length) {
    and.push({ targetCharacterId: { in: filters.targets } });
  }

  // Zone is a TARGET-character property — where they are standing; resolved to character ids.
  if (filters.zones.length) {
    const set = new Set(filters.zones);
    and.push({
      targetCharacterId: { in: ctx.characters.filter((c) => set.has(c.zone?.id)).map((c) => c.id) },
    });
  }

  // WHERE it happened: real columns, forward-only — a pre-column row is NULL, which never matches `in`.
  if (filters.locations.length) {
    and.push({ locationId: { in: filters.locations } });
  }
  if (filters.rooms.length) {
    and.push({ roomId: { in: filters.rooms } });
  }

  // Date: from/to, preset and turn range all compose (AND), so "this turn" plus a From date intersects rather than overrides.
  const windows = [];
  if (filters.preset) windows.push(presetWindow(filters.preset, ctx.turns));
  if (filters.turnFrom || filters.turnTo) windows.push(turnWindow(ctx.turns, filters.turnFrom, filters.turnTo));
  if (filters.from) windows.push({ gte: filters.from, lt: null });
  if (filters.to) windows.push({ gte: null, lt: filters.to });
  for (const w of windows) {
    if (w.gte) and.push({ createdAt: { gte: w.gte } });
    if (w.lt) and.push({ createdAt: { lt: w.lt } });
  }

  if (filters.q) {
    // Split into bare terms and field:/@ scopes; each word is its own AND entry.
    const { bare, scoped } = parseQuery(filters.q);
    const words = [...bare.map((term) => ({ term, field: null })), ...scoped];
    for (const word of words) {
      and.push(await wordWhere(word, ctx));
    }
  }

  return and.length ? { AND: and } : {};
}

export { auditFamily, DATE_PRESETS };
