import { prisma, Prisma } from "@lifeweb/db";
import { railKindSql, withoutDmNoise, dmPreview } from "./dmThread";
import { listGuildMembers } from "./discordGuild";
import { pgNowMs } from "./pgClock";

// The live half of the player desk: "what changed since the last time you
// asked". The desk's 30s router.refresh() poll can never reseed the open
// conversation (its state is seeded once), so before this a GM waiting on a
// reply had to reload the page. Now the client asks this every ~3s and gets
// back only the rows that moved.
//
// Every timestamp here comes from Postgres's clock, never Date.now(). The
// web container and the database are different machines, and a few hundred
// ms of drift the wrong way would blind the cursor for good. The client
// hands `nowMs` straight back as its next `since`, minus OVERLAP_MS so a row
// that committed a moment after its createdAt (transaction start) is still
// caught — the client dedupes by id, so seeing a row twice is free.
//
// The 30s refresh stays as the rail's correctness backstop. The open thread
// has no such backstop, so the client asks for the full tail every 20th tick.
const OVERLAP_MS = 10_000;
const COLD_START_MS = 120_000;
const TOUCHED_LIMIT = 500;
const THREAD_LIMIT = 60;

// createdAt is timestamp(3) without a zone, holding UTC (Prisma's convention).
// `AT TIME ZONE 'UTC'` turns the epoch back into that same nominal UTC
// timestamp, so the comparison holds whatever the session's TimeZone is.
function sinceSql(sinceMs) {
  return Prisma.sql`(to_timestamp(${sinceMs / 1000}) AT TIME ZONE 'UTC')`;
}

export async function getInboxDelta({ gmDiscordUserId, sinceMs, openDiscordUserId = null, full = false }) {
  const since = Number.isFinite(sinceMs) && sinceMs > 0 ? sinceMs : null;
  const open = openDiscordUserId ? String(openDiscordUserId) : null;

  // No cursor yet (first tick, or a page restored from bfcache): look back a
  // couple of minutes rather than at the whole table.
  const nowMs = await pgNowMs();
  const effectiveSince = since ?? nowMs - COLD_START_MS;
  const sinceDate = new Date(effectiveSince);

  // Two predicates in one function, and they are not interchangeable. The rail
  // half asks "did a person say something" — a notice must not touch, sort or
  // preview a row. The open thread asks "is there anything to draw", notices
  // included, or a grey line would appear on a server render and vanish on the
  // next 3 s tick.
  const [touchedRows, threadRows] = await Promise.all([
    prisma.$queryRaw`
      WITH touched AS (
        SELECT DISTINCT "discordUserId" FROM (
          (SELECT dm."discordUserId"
             FROM "DirectMessage" dm
            WHERE dm."createdAt" > ${sinceSql(effectiveSince)}
              AND ${railKindSql("dm")}
            ORDER BY dm."createdAt" DESC
            LIMIT ${TOUCHED_LIMIT})
          UNION
          SELECT cr."playerDiscordUserId"
            FROM "ConversationRead" cr
           WHERE cr."gmDiscordUserId" = ${gmDiscordUserId}
             AND cr."lastReadAt" > ${sinceSql(effectiveSince)}
          UNION
          SELECT ${open}::text WHERE ${open}::text IS NOT NULL
        ) s
      ),
      latest AS (
        SELECT DISTINCT ON (dm."discordUserId")
               dm."discordUserId", dm."direction", dm."createdAt", dm."content",
               dm."authorDiscordUserId"
          FROM "DirectMessage" dm
          JOIN touched t ON t."discordUserId" = dm."discordUserId"
         WHERE ${railKindSql("dm")}
         ORDER BY dm."discordUserId", dm."createdAt" DESC
      ),
      unread AS (
        SELECT dm."discordUserId", COUNT(*)::int AS "unreadCount"
          FROM "DirectMessage" dm
          JOIN touched t ON t."discordUserId" = dm."discordUserId"
          LEFT JOIN "ConversationRead" cr
            ON cr."playerDiscordUserId" = dm."discordUserId"
           AND cr."gmDiscordUserId" = ${gmDiscordUserId}
         WHERE dm."direction" = 'INBOUND'
           AND dm."createdAt" > COALESCE(cr."lastReadAt", to_timestamp(0))
           AND ${railKindSql("dm")}
         GROUP BY dm."discordUserId"
      )
      SELECT t."discordUserId",
             l."direction" AS "lastDirection",
             (EXTRACT(EPOCH FROM l."createdAt") * 1000)::double precision AS "lastAtMs",
             l."content" AS "lastContent",
             l."authorDiscordUserId" AS "lastAuthor",
             COALESCE(u."unreadCount", 0) AS "unreadCount",
             (EXTRACT(EPOCH FROM cm."handledAt") * 1000)::double precision AS "handledAtMs",
             (cmu."id" IS NOT NULL) AS "muted",
             cm."claimedByDiscordUserId",
             -- This GM's read cursor, shipped so the client can tell whether
             -- its own optimistic "I have read this" has been overtaken by
             -- the server yet (liveInbox.js#reconcileReadOverrides). Without
             -- it the override would have to clear on a timer and guess.
             (EXTRACT(EPOCH FROM cr."lastReadAt") * 1000)::double precision AS "lastReadAtMs"
        FROM touched t
        LEFT JOIN latest l ON l."discordUserId" = t."discordUserId"
        LEFT JOIN unread u ON u."discordUserId" = t."discordUserId"
        LEFT JOIN "ConversationMeta" cm ON cm."playerDiscordUserId" = t."discordUserId"
        LEFT JOIN "ConversationMute" cmu
          ON cmu."playerDiscordUserId" = t."discordUserId"
         AND cmu."gmDiscordUserId" = ${gmDiscordUserId}
        LEFT JOIN "ConversationRead" cr
          ON cr."playerDiscordUserId" = t."discordUserId"
         AND cr."gmDiscordUserId" = ${gmDiscordUserId}
    `,
    open
      ? prisma.directMessage.findMany({
          where: withoutDmNoise(full ? { discordUserId: open } : { discordUserId: open, createdAt: { gt: sinceDate } }),
          orderBy: [{ createdAt: "desc" }, { id: "desc" }],
          take: THREAD_LIMIT,
          select: {
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
          },
        })
      : null,
  ]);

  // A touched conversation with nothing a person said in it has no lastAtMs —
  // the open one always is touched, whether or not it has moved. Leave the
  // server's row alone rather than patching it with blanks.
  const touched = touchedRows.filter((r) => r.lastAtMs != null);

  // Someone the rail has never heard of — a guild member with no character
  // who just wrote for the first time. Ship a whole row so they show up
  // now, not on the next 30s refresh. Both lookups are cheap: characters by
  // an indexed column, members from the 5-minute cache.
  let rowsById = new Map();
  if (touched.length > 0) {
    const ids = touched.map((r) => r.discordUserId);
    const [characters, members] = await Promise.all([
      prisma.character.findMany({
        where: { discordUserId: { in: ids } },
        select: { id: true, discordUserId: true, status: true, updatedAt: true },
      }),
      listGuildMembers(),
    ]);
    const hasCharacter = new Set(characters.map((c) => c.discordUserId));
    const memberById = new Map(members.map((m) => [m.id, m]));
    for (const id of ids) {
      if (hasCharacter.has(id)) continue;
      const m = memberById.get(id);
      rowsById.set(id, {
        discordUserId: id,
        characterId: null,
        avatarVersion: null,
        name: m?.username || id,
        roleTitle: "",
        factionId: null,
        factionName: "",
        factionZoneName: "",
        zoneName: "",
        status: null,
        resources: 0,
        cursed: false,
        catatonic: false,
        username: m?.username ?? "",
        globalName: m?.globalName ?? "",
        tag: "",
        tagNames: [],
      });
    }
  }

  const rail = touched.map((r) => {
    const lastAtMs = Number(r.lastAtMs);
    const patch = {
      discordUserId: r.discordUserId,
      lastAtMs,
      lastDirection: r.lastDirection,
      // dmPreview returns the line itself, not { preview } — spreading it put
      // its characters on the patch and left `preview` unset, so every row a
      // GM message touched fell back to the role title ("Baroness").
      preview: dmPreview(
        { direction: r.lastDirection, content: r.lastContent, authorDiscordUserId: r.lastAuthor },
        gmDiscordUserId,
      ),
      unreadCount: Number(r.unreadCount ?? 0),
      lastReadAtMs: r.lastReadAtMs != null ? Number(r.lastReadAtMs) : 0,
      handled: r.handledAtMs != null && Number(r.handledAtMs) >= lastAtMs,
      muted: Boolean(r.muted),
      claimedByDiscordUserId: r.claimedByDiscordUserId ?? null,
      hasConversation: true,
    };
    const row = rowsById.get(r.discordUserId);
    if (row) patch.row = row;
    return patch;
  });

  const thread = open
    ? {
        discordUserId: open,
        messages: (threadRows ?? [])
          .slice()
          .reverse()
          .map((m) => ({ ...m, createdAt: m.createdAt.toISOString() })),
      }
    : null;

  return { nowMs, cursorMs: nowMs - OVERLAP_MS, rail, thread };
}
