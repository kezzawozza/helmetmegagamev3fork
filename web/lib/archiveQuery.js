// Two surfaces read the same rows — the page's first screen and the endpoint
// that feeds the scroll — and they MUST agree about the filter and the order.
// No prisma import, so the client can use `archiveParamsToQuery` without dragging PrismaClient into the bundle (ARCHITECTURE.md §2).

export const ARCHIVE_PAGE_SIZE = 60;

export function parseArchiveParams(params = {}) {
  const get = (key) => params?.[key]?.toString().trim() || "";
  const day = get("day");
  const dayNumber = day ? Number.parseInt(day, 10) : null;
  return {
    game: get("game"),
    zone: get("zone"),
    character: get("character"),
    day,
    dayTurns: dayNumber && dayNumber > 0 ? [dayNumber * 2 - 1, dayNumber * 2] : null,
    q: get("q"),
    show: params?.show?.toString() === "all" ? "all" : "speech",
    order: params?.order?.toString() === "desc" ? "desc" : "asc",
  };
}

export function activeArchiveFilters(f) {
  const on = [];
  if (f.q) on.push({ key: "q", label: `“${f.q}”` });
  if (f.day) on.push({ key: "day", label: `Day ${f.day}` });
  if (f.zone) on.push({ key: "zone", label: f.zone });
  if (f.character) on.push({ key: "character", label: "one speaker" });
  return on;
}

export function archiveWhere(gameId, f) {
  return {
    gameId,
    deletedAt: null,
    // MESSAGE rows the world writes itself (db/lib/scene.js) carry `source: SYSTEM`; Speech leaves them out.
    ...(f.show === "speech"
      ? { OR: [{ kind: "TURN_START" }, { kind: "MESSAGE", source: { not: "SYSTEM" } }] }
      : {}),
    ...(f.zone ? { zoneName: f.zone } : {}),
    ...(f.character ? { characterId: f.character } : {}),
    ...(f.dayTurns ? { turnNumber: { in: f.dayTurns } } : {}),
    ...(f.q ? { content: { contains: f.q, mode: "insensitive" } } : {}),
  };
}

// `sentAt` then `id`, NOT `seq` — seq is assigned at INSERT, so a message recovered after the
// bot was down (bot/src/lib/messageCatchUp.js) carries a real sentAt from hours earlier but a
// brand-new seq; ordering by it would file the message at the wrong moment, which is precisely
// the lie a transcript must not tell. id breaks ties (sentAt is ms-resolution). @@index([gameId, sentAt, id]).
export function archiveOrderBy(order) {
  return [{ sentAt: order }, { id: order }];
}

export function archiveCursorWhere(cursor, order) {
  if (!cursor) return {};
  const at = cursor.lastIndexOf("|");
  if (at <= 0) return {};
  const sentAt = new Date(cursor.slice(0, at));
  const id = cursor.slice(at + 1);
  if (Number.isNaN(sentAt.getTime()) || !id) return {};
  const after = order === "desc" ? "lt" : "gt";
  return { OR: [{ sentAt: { [after]: sentAt } }, { sentAt, id: { [after]: id } }] };
}

export function archiveCursorOf(row) {
  if (!row?.sentAt) return null;
  const iso = typeof row.sentAt === "string" ? row.sentAt : new Date(row.sentAt).toISOString();
  return `${iso}|${row.id}`;
}

export function archiveParamsToQuery(f, overrides = {}) {
  const merged = { game: f.game, zone: f.zone, character: f.character, day: f.day, q: f.q, show: f.show, order: f.order, ...overrides };
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(merged)) {
    if (value == null || value === "") continue;
    if (key === "show" && value === "speech") continue;
    if (key === "order" && value === "asc") continue;
    out.set(key, String(value));
  }
  return out.toString();
}
