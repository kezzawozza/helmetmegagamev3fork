import { Prisma } from "@lifeweb/db";
import { DM_KIND, MENTION_SOURCE } from "@lifeweb/db/lib/dmKinds";

// "Is this row conversation?" decides the RAIL; "is this row drawable?" decides a THREAD. Both key on `DirectMessage.kind` alone.
const IS_DRAWABLE = { kind: { not: DM_KIND.QUIET } };

// Null-tolerant OR: `source` is NULL on most rows, and SQL drops a NULL row under a plain `not` predicate.
const NOT_MENTION = { OR: [{ source: null }, { source: { not: MENTION_SOURCE } }] };

export function withoutDmNoise(where, { perspective = "gm" } = {}) {
  const extra = perspective === "player" ? [] : [NOT_MENTION];
  return { ...where, AND: [...(where?.AND ?? []), IS_DRAWABLE, ...extra] };
}

// The raw-SQL twins, for $queryRaw call sites that can't take a Prisma `where`. `alias` is a code-supplied
// literal (the table alias in the caller's FROM), never user input, so Prisma.raw is safe here.
function col(alias, c) {
  return Prisma.raw(alias ? `${alias}."${c}"` : `"${c}"`);
}

export function railKindSql(alias) {
  return Prisma.sql`${col(alias, "kind")} = ${DM_KIND.CONVERSATION}`;
}

// The raw twin of withoutDmNoise, for the desk's message-content search (app/api/gm/conversation-search).
export function threadKindSql(alias, { perspective = "gm" } = {}) {
  const base = Prisma.sql`${col(alias, "kind")} <> ${DM_KIND.QUIET}`;
  if (perspective === "player") return base;
  return Prisma.sql`${base} AND (${col(alias, "source")} IS DISTINCT FROM ${MENTION_SOURCE})`;
}

// Kept in step with web/lib/inboxDelta.js, which builds the same preview.
export function dmPreview(latest, myDiscordUserId) {
  if (!latest?.content) return "";
  const label =
    latest.direction === "INBOUND" ? ""
    : !latest.authorDiscordUserId ? "Bot: "
    : latest.authorDiscordUserId === myDiscordUserId ? "You: "
    : "GM: ";
  return `${label}${latest.content}`;
}

// What Chat hands a PLAYER about their own conversation (CHAT.md §2b): `authorDiscordUserId` is
// deliberately not selected — a player never learns which GM answered.
export const PLAYER_DM_SELECT = {
  id: true,
  direction: true,
  content: true,
  source: true,
  kind: true,
  createdAt: true,
  meta: true,
  clientNonce: true,
};

// Wider than PLAYER_DM_SELECT: authorDiscordUserId for dmPreview, `kind` for notice styling.
export const GM_DM_SELECT = {
  id: true,
  discordUserId: true,
  direction: true,
  content: true,
  authorDiscordUserId: true,
  source: true,
  kind: true,
  createdAt: true,
  meta: true,
  clientNonce: true,
};

export function gmDmRow(row) {
  return {
    id: row.id,
    discordUserId: row.discordUserId,
    direction: row.direction,
    content: row.content,
    authorDiscordUserId: row.authorDiscordUserId ?? null,
    source: row.source ?? null,
    kind: row.kind,
    meta: row.meta ?? null,
    clientNonce: row.clientNonce ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function playerDmRow(row) {
  return {
    id: row.id,
    direction: row.direction,
    content: row.content,
    source: row.source ?? null,
    kind: row.kind,
    meta: row.meta ?? null,
    clientNonce: row.clientNonce ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}
